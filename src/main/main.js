'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  screen,
  nativeImage,
  shell,
  protocol,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const memory = require('./memory');

const ASSETS_ROOT = path.join(__dirname, '..', '..', 'assets');
const AUDIO_DIR = path.join(ASSETS_ROOT, 'audio');

/**
 * 语音文件名的唯一来源。
 *
 * 渲染层不再自己拼路径，启动时通过 IPC 取——之前角色路径写了两份，
 * 换素材时改漏一处，调试页和桌面看到的不是同一个人。
 */
const VOICE = {
  pack: 'amiya.ogg',
  segments: 'amiya.segments.json',
  lines: 'amiya.lines.json',
};

function audioPath(name) {
  return path.join(AUDIO_DIR, name);
}

/** 调试模式：带 --dev 启动时打开 DevTools */
const DEV_MODE = process.argv.includes('--dev');

/** 语音标注工具模式：单独开一个正常窗口，不创建桌宠 */
const LABEL_MODE = process.env.PET_VOICE_LABEL === '1';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.atlas': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.skel': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/**
 * 自定义协议。
 *
 * 为什么不能直接 file://：pixi 用 XHR 读 .skel 和 .atlas，
 * file:// 页面的 origin 是 null，请求会被 CORS 拦下来。
 * 走一个带 corsEnabled 的私有协议，既绕开限制又不放宽 webSecurity。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pet',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const WIN_WIDTH = 380;
// 高度里有一段是留给头顶气泡的：角色本身只占下半部分（见 pet.js 的 BUBBLE_RESERVE）。
// 不留这段的话，人和气泡塞在一个窗口里，气泡会被顶到耳朵上。
const WIN_HEIGHT = 620;
const EDGE_MARGIN = 16;

let win = null;
let tray = null;
let ignoringMouse = true;
let dragOrigin = null;
let companion = null;
let labelWin = null;
let muted = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (!win) return;
  win.showInactive();
});

function cornerPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + area.width - WIN_WIDTH - EDGE_MARGIN),
    y: Math.round(area.y + area.height - WIN_HEIGHT + 8),
  };
}

function applyIgnore(next) {
  if (!win || win.isDestroyed() || next === ignoringMouse) return;
  ignoringMouse = next;
  if (next) {
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    win.setIgnoreMouseEvents(false);
  }
}

/**
 * 渲染进程日志转发。
 * 新版 Electron 只传一个事件对象，而且会按参数个数判断是不是旧写法——
 * 只要声明了 (event, level, message)，就会一直刷 deprecation。所以只收一个参数。
 */
function forwardConsole(tag) {
  return (event) => {
    console.log(`[${tag}] ${(event && event.message) || ''}`);
  };
}

function createWindow() {
  const { x, y } = cornerPosition();

  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoringMouse = true;

  const entry = process.env.PET_SPINE_TEST === '1' ? 'spine-test.html' : 'index.html';
  win.loadFile(path.join(__dirname, '..', 'renderer', entry));

  win.once('ready-to-show', () => {
    win.showInactive();
  });

  // --dev：开一个独立的 DevTools 窗口方便看报错。
  // 用 detach 而不是内嵌，否则 DevTools 会占掉这个 380x520 的透明窗口。
  if (DEV_MODE) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('console-message', forwardConsole('renderer'));

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[load-fail]', code, desc);
  });

  if (process.env.PET_SMOKE === '1') {
    setTimeout(async () => {
      if (process.env.PET_PROBE === '1') {
        try {
          const probe = await win.webContents.executeJavaScript(`(async () => {
            const d = window.__petDebug;
            if (!d) return { error: 'no debug hook' };
            const idle = d.state();
            d.playOnce('interact');
            const samples = [];
            for (let i = 0; i < 8; i++) {
              await new Promise((r) => setTimeout(r, 120));
              const s = d.state();
              samples.push([s.head ? s.head.y : null, Math.round(s.anchor.y), s.rect[1]]);
            }
            return { idleHead: idle.head && idle.head.y, idleAnchor: Math.round(idle.anchor.y), samples };
          })()`);
          console.log('[probe]', JSON.stringify(probe));
        } catch (err) {
          console.error('[probe] failed', err);
        }
      }

      // 语音探针：发一次真实的鼠标点击（算用户手势，否则 AudioContext 不肯出声），
      // 再看气泡里显示的字和播放状态对不对
      if (process.env.PET_VOICE_PROBE === '1') {
        try {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          await win.webContents.executeJavaScript(`window.__petDebug.say('')`);
          win.webContents.sendInputEvent({ type: 'mouseDown', x: 192, y: 380, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x: 192, y: 380, button: 'left', clickCount: 1 });
          await wait(800);
          const probe = await win.webContents.executeJavaScript(`(() => ({
            voice: window.__petDebug.voice(),
            bubble: document.getElementById('bubble-text').textContent,
            shown: document.getElementById('bubble').classList.contains('show'),
          }))()`);
          console.log('[voiceprobe]', JSON.stringify(probe));
        } catch (err) {
          console.error('[voiceprobe] failed', err);
        }
      }

      try {
        const diag = await win.webContents.executeJavaScript(`(() => {
          const el = document.getElementById('bubble');
          const extra = {};
          if (el) {
            const r = el.getBoundingClientRect();
            const t = document.getElementById('bubble-text');
            extra.bubbleShown = el.classList.contains('show');
            extra.bubbleText = t ? t.textContent.slice(0, 24) : '';
            extra.bubbleRect = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
          }
          return Object.assign({}, window.__diag || {}, extra);
        })()`);
        console.log('[diag]', JSON.stringify(diag));
      } catch (err) {
        console.error('[diag] failed', err);
      }

      try {
        const { desktopCapturer } = require('electron');
        const display = screen.getPrimaryDisplay();
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.round(display.size.width * display.scaleFactor),
            height: Math.round(display.size.height * display.scaleFactor),
          },
        });
        if (sources[0]) {
          fs.writeFileSync(
            path.join(process.cwd(), 'pet-desktop.png'),
            sources[0].thumbnail.toPNG()
          );
          console.log('[smoke] desktop captured');
        }
      } catch (err) {
        console.error('[smoke] desktop capture failed', err);
      }

      try {
        const image = await win.webContents.capturePage();
        const out = path.join(process.cwd(), 'pet-smoke.png');
        fs.writeFileSync(out, image.toPNG());
        console.log('[smoke] captured', out);
      } catch (err) {
        console.error('[smoke] capture failed', err);
      }
      console.log('[smoke] ok');
      app.exit(0);
    }, 3500);
  }
}

/**
 * 语音标注窗口。
 *
 * 和桌宠窗口完全两套东西：有标题栏、可缩放、不透明、不进托盘。
 * 它的唯一用途是让人边听边把每段语音的字幕打上去。
 */
function createLabelWindow() {
  labelWin = new BrowserWindow({
    width: 940,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: '语音标注',
    backgroundColor: '#12161b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  labelWin.loadFile(path.join(__dirname, '..', 'renderer', 'audio-label.html'));

  labelWin.once('ready-to-show', () => labelWin.show());
  labelWin.on('closed', () => {
    labelWin = null;
  });

  labelWin.webContents.on('console-message', forwardConsole('label'));

  // 自动化验收：检查分段是否载入、音频是否解码成功，并截一张图
  if (process.env.PET_SMOKE === '1') {
    setTimeout(async () => {
      try {
        const info = await labelWin.webContents.executeJavaScript(`(() => ({
          status: document.getElementById('status').textContent,
          progress: document.getElementById('progress').textContent,
          rows: document.querySelectorAll('.row').length,
          first: (document.querySelector('.row .time') || {}).textContent || null,
          diag: window.__labelDiag || null,
        }))()`);
        console.log('[label]', JSON.stringify(info));
      } catch (err) {
        console.error('[label] diag failed', err);
      }

      // 走一遍真实交互：往输入框里塞字、点保存，再看文件有没有落下来。
      // 只测 DOM 事件通不通不算数，要测最后那个 JSON。
      try {
        const round = await labelWin.webContents.executeJavaScript(`(async () => {
          const inputs = [...document.querySelectorAll('.row .text')];
          for (let i = 0; i < 2 && i < inputs.length; i++) {
            inputs[i].value = 'TEST_' + i;
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          }
          document.getElementById('save').click();
          await new Promise((r) => setTimeout(r, 600));
          return document.getElementById('status').textContent;
        })()`);
        const saved = readJsonSafe(audioPath(VOICE.lines));
        console.log('[label] save ->', round, '| file lines:', saved ? saved.lines.length : null);
      } catch (err) {
        console.error('[label] save test failed', err);
      }
      try {
        const img = await labelWin.webContents.capturePage();
        fs.writeFileSync(path.join(process.cwd(), 'label-shot.png'), img.toPNG());
        console.log('[label] captured');
      } catch (err) {
        console.error('[label] capture failed', err);
      }
      app.exit(0);
    }, 5000);
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'brand', 'tray.png');
  if (!fs.existsSync(iconPath)) {
    console.warn('[tray] 缺少 assets/brand/tray.png，跳过托盘。运行 npm run icon 生成。');
    return;
  }

  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('桌宠');

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: win && win.isVisible() ? '让她休息（隐藏）' : '叫她出来（显示）',
        click: () => {
          if (!win) return;
          if (win.isVisible()) {
            win.hide();
          } else {
            win.showInactive();
          }
          rebuild();
        },
      },
      {
        label: '总在最前',
        type: 'checkbox',
        checked: win ? win.isAlwaysOnTop() : true,
        click: (item) => {
          if (win) win.setAlwaysOnTop(item.checked, 'screen-saver');
        },
      },
      {
        label: '静音（只显示文字）',
        type: 'checkbox',
        checked: muted,
        click: (item) => {
          muted = item.checked;
          if (win && !win.isDestroyed()) win.webContents.send('pet:muted', muted);
        },
      },
      { type: 'separator' },
      {
        label: '回到右下角',
        click: () => {
          if (!win) return;
          const { x, y } = cornerPosition();
          win.setPosition(x, y);
        },
      },
      {
        label: '数据文件夹',
        click: () => shell.openPath(app.getPath('userData')),
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };

  rebuild();
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.showInactive();
    rebuild();
  });
}

ipcMain.on('pet:hit', (_event, inside) => {
  applyIgnore(!inside);
});

ipcMain.on('pet:drag-begin', (_event, point) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  dragOrigin = { winX: x, winY: y, mouseX: point.x, mouseY: point.y };
});

ipcMain.on('pet:drag-move', (_event, point) => {
  if (!win || win.isDestroyed() || !dragOrigin) return;
  const nextX = Math.round(dragOrigin.winX + point.x - dragOrigin.mouseX);
  const nextY = Math.round(dragOrigin.winY + point.y - dragOrigin.mouseY);
  win.setPosition(nextX, nextY);
});

ipcMain.on('pet:drag-end', () => {
  dragOrigin = null;
});

ipcMain.on('pet:click', () => {
  memory.addClick();
});

ipcMain.handle('pet:companion', () => companion);

/* ------------------------------------------------------------------ *
 * 语音
 * ------------------------------------------------------------------ */

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

ipcMain.handle('pet:voice-info', () => {
  const hasPack = fs.existsSync(audioPath(VOICE.pack));
  const hasLines = fs.existsSync(audioPath(VOICE.lines));
  return {
    // 路径由主进程给，渲染层不自己拼——文件名只在这一处定义
    packUrl: hasPack ? `pet://audio/${VOICE.pack}` : null,
    linesUrl: hasLines ? `pet://audio/${VOICE.lines}` : null,
    label: hasPack ? VOICE.pack : null,
  };
});

ipcMain.handle('pet:is-muted', () => muted);

ipcMain.handle('voice:load', () => {
  const segFile = audioPath(VOICE.segments);
  const lineFile = audioPath(VOICE.lines);
  const seg = readJsonSafe(segFile);
  const lines = readJsonSafe(lineFile);
  return {
    segments: seg && Array.isArray(seg.segments) ? seg.segments : null,
    duration: seg ? seg.duration : null,
    lines: lines && Array.isArray(lines.lines) ? lines.lines : null,
    paths: { segments: segFile, lines: lineFile },
  };
});

ipcMain.handle('voice:save', (_event, payload) => {
  try {
    if (!payload || !Array.isArray(payload.lines)) throw new Error('格式不对');
    // 只留运行时真正要用的字段，顺手把空字幕滤掉
    const clean = payload.lines
      .filter((l) => l && Number.isFinite(l.start) && Number.isFinite(l.dur))
      .map((l) => ({
        start: Math.round(l.start * 1000) / 1000,
        dur: Math.round(l.dur * 1000) / 1000,
        text: String(l.text || '').trim(),
      }));

    const out = {
      pack: VOICE.pack,
      updatedAt: new Date().toISOString(),
      lines: clean,
    };
    fs.writeFileSync(audioPath(VOICE.lines), JSON.stringify(out, null, 2), 'utf8');
    return { ok: true, saved: clean.length, path: audioPath(VOICE.lines) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

function registerAssetProtocol() {
  protocol.handle('pet', async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.host + url.pathname);
      const target = path.normalize(path.join(ASSETS_ROOT, rel));

      if (!target.startsWith(ASSETS_ROOT)) {
        return new Response('forbidden', { status: 403 });
      }

      const data = await fs.promises.readFile(target);
      const mime = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      return new Response(new Uint8Array(data), { headers: { 'content-type': mime } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

app.on('ready', () => {
  registerAssetProtocol();

  // 标注工具不创建桌宠：它是一把临时用的尺子，用完就关
  if (LABEL_MODE) {
    createLabelWindow();
    return;
  }

  companion = memory.touch();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
