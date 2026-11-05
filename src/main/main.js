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
const settings = require('./settings');

const ASSETS_ROOT = path.join(__dirname, '..', '..', 'assets');
const AUDIO_DIR = path.join(ASSETS_ROOT, 'audio');
const CHARACTER_DIR = path.join(ASSETS_ROOT, 'character');

/**
 * 时装清单的唯一来源。
 * 这里只列"应该有哪些"，实际可用与否要按文件是否存在过滤——
 * 别人 clone 下来没有素材，菜单里就不该冒出点不动的项。
 */
const OUTFIT_LIST = require('../shared/outfits.json').outfits;

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

/* ------------------------------------------------------------------ *
 * 时装
 * ------------------------------------------------------------------ */

function outfitUrl(outfit) {
  return `pet://character/${outfit.file}.skel`;
}

/** 只留三件套齐全的——缺图集会渲染成一片空白，比菜单里没有更让人困惑 */
function availableOutfits() {
  return OUTFIT_LIST.filter((o) =>
    ['skel', 'atlas', 'png'].every((ext) =>
      fs.existsSync(path.join(CHARACTER_DIR, `${o.file}.${ext}`))
    )
  );
}

function publicOutfit(outfit) {
  return { id: outfit.id, name: outfit.name, url: outfitUrl(outfit) };
}

let currentOutfit = null;

/**
 * 决定穿哪套：上次选的那套，素材被删了就退回清单里的第一套。
 * 不按文件时间排序——换台机器拷贝的顺序不同，选择就会莫名其妙地变。
 */
function resolveOutfit() {
  const list = availableOutfits();
  if (!list.length) {
    console.warn('[outfit] assets/character/ 下没有完整的三件套，角色不会出现');
    return null;
  }
  const saved = settings.get('outfit');
  currentOutfit = list.find((o) => o.id === saved) || list[0];
  if (saved !== currentOutfit.id) settings.set('outfit', currentOutfit.id);
  return currentOutfit;
}

function applyOutfit(id) {
  const target = availableOutfits().find((o) => o.id === id);
  if (!target || (currentOutfit && target.id === currentOutfit.id)) {
    // 没真正切换也刷一次，让菜单里的勾选回到正确的那一项
    refreshTray();
    return;
  }
  currentOutfit = target;
  settings.set('outfit', target.id);
  if (win && !win.isDestroyed()) win.webContents.send('pet:outfit', publicOutfit(target));
  refreshTray();
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
  if (!win || win.isDestroyed()) return;
  win.showInactive();

  /**
   * 用户又点了一次启动器：多半是刚更新过代码（或者上次没关干净）。
   *
   * 不 reload 的话，已经跑着的旧进程会一直用内存里的旧脚本，
   * 新功能永远不生效，用户看到的就是"双击了但什么都没变"——
   * 这种情况只能去托盘退出再启动，很容易被当成程序坏了。
   */
  if (process.env.PET_SMOKE !== '1' && process.env.PET_OUTFIT_SWEEP !== '1') {
    win.webContents.reload();
  }
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

  /**
   * 六套时装逐个切换验收。
   * 走的是完整链路：写设置 -> IPC 推送 -> 渲染层销毁旧骨架换新的，
   * 和点托盘菜单是同一条路，不是直接改渲染层变量。
   */
  if (process.env.PET_OUTFIT_SWEEP === '1') {
    setTimeout(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const list = availableOutfits();
      console.log('[sweep] 共 ' + list.length + ' 套');

      for (const o of list) {
        try {
          await win.webContents.executeJavaScript(
            `window.__petDebug.setOutfit(${JSON.stringify(o.id)})`
          );
        } catch (err) {
          console.error('[sweep] 切换失败 ' + o.id, err);
        }
        await wait(1800);

        // 说一句再截：气泡才是最容易因为"换了个更高的头"而压上去的东西
        try {
          await win.webContents.executeJavaScript(
            `window.__petDebug.say('${o.name.replace(/'/g, "\\'")}')`
          );
          await wait(500);
        } catch {
          /* 说话失败不影响截图 */
        }

        let diag = null;
        try {
          diag = await win.webContents.executeJavaScript(`(() => {
            const d = window.__diag || {};
            const b = document.getElementById('bubble');
            return {
              stage: d.stage,
              outfit: d.outfit,
              head: d.headBone,
              rect: d.hitRect,
              anchor: d.headAnchor,
              profile: d.topProfile,
              anims: d.animations || [],
              bubble: b ? b.classList.contains('show') : null,
            };
          })()`);
        } catch (err) {
          diag = { error: String((err && err.message) || err) };
        }

        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(process.cwd(), `outfit-${o.id}.png`), img.toPNG());
        } catch (err) {
          console.error('[sweep] 截图失败 ' + o.id, err);
        }

        console.log('[sweep] ' + JSON.stringify({ id: o.id, ...diag }));
      }

      console.log('[sweep] done');
      app.exit(0);
    }, 3200);
  }

  /**
   * 姿态验收：强制切 relax / sit，看姿态对不对、气泡有没有压到头、
   * 命中框有没有跟着缩回去。状态机正常要等一分半才自己动，验收等不起。
   */
  if (process.env.PET_MOOD_PROBE === '1') {
    setTimeout(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      // 最后回到 idle：验证从坐姿站起来能回到原来的位置，
      // 而不是被"贴底修正"一路推上去回不来
      for (const m of ['relax', 'sit', 'sleep', 'idle']) {
        try {
          await win.webContents.executeJavaScript(`window.__petDebug.mood('${m}')`);
        } catch (err) {
          console.error('[mood] 切换失败 ' + m, err);
        }
        // 等姿态混合 + 逐帧托底跑完（settle 约 1.5s），否则读到的是上一个姿态的命中框
        await wait(2600);

        // 先说一句：坐着也要能正常说话，气泡要跟着新的头顶高度重新贴上去。
        // 先 say 后读 diag，读到的才是气泡的真实位置，不是隐藏状态的旧值
        try {
          await win.webContents.executeJavaScript(`window.__petDebug.say('坐一会儿。')`);
          await wait(600);
        } catch {
          /* 说话失败不影响截图 */
        }

        let diag = null;
        try {
          diag = await win.webContents.executeJavaScript(`(() => {
            const d = window.__diag || {};
            const b = document.getElementById('bubble');
            return {
              mood: d.mood,
              rect: d.hitRect,
              anchor: d.headAnchor,
              profile: d.topProfile,
              bubbleTop: b && b.classList.contains('show') ? Math.round(b.getBoundingClientRect().top) : null,
            };
          })()`);
        } catch (err) {
          diag = { error: String((err && err.message) || err) };
        }

        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(process.cwd(), `mood-${m}.png`), img.toPNG());
        } catch (err) {
          console.error('[mood] 截图失败 ' + m, err);
        }

        console.log('[mood] ' + JSON.stringify({ id: m, ...diag }));
      }

      console.log('[mood] done');
      app.exit(0);
    }, 3200);
  }

  /**
   * 状态机流转验收。
   *
   * 不靠肉眼等一分半：把"上次互动时间"往前推，让真实的定时器自己到点。
   * 走的是和生产完全一样的链路，只是时间戳被改了。
   */
  if (process.env.PET_FLOW_PROBE === '1') {
    setTimeout(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const run = (js) => win.webContents.executeJavaScript(js);

      const step = async (label, seconds) => {
        await run(`window.__petDebug.ago(${seconds})`);
        // ago 之后状态机还要排 1.5s 才切，切完 settle 要跑 1.5s 才更新命中框，留足
        await wait(3800);
        const s = await run(
          `({ mood: window.__diag.mood, rect: window.__diag.hitRect, bubble: document.getElementById('bubble').classList.contains('show') })`
        );
        console.log('[flow] ' + JSON.stringify({ label, ...s }));
      };

      await step('闲置 95s', 95);
      await step('闲置 250s', 250);
      await step('闲置 620s（非深夜，应停在 sit）', 620);

      // 点一下，看她能不能从坐姿站起来
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 192, y: 430, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 192, y: 430, button: 'left', clickCount: 1 });
      await wait(3400);
      const after = await run(
        `({ mood: window.__diag.mood, rect: window.__diag.hitRect, bubble: document.getElementById('bubble').classList.contains('show') })`
      );
      console.log('[flow] ' + JSON.stringify({ label: '点击之后', ...after }));

      app.exit(0);
    }, 3200);
  }

  /**
   * 待机动作幅度 + 坐下瞬间出框曲线。
   *
   * 「太呆滞」是主观判断，先量一下 Default 到底动了多少；
   * 「刚坐下腿会没」也要知道消失持续多久，才知道要修到什么程度。
   */
  if (process.env.PET_IDLE_PROBE === '1') {
    setTimeout(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const run = (js) => win.webContents.executeJavaScript(js);

      // 1) 待机 4 秒内的包围盒抖动 + 微动角度
      const idle = [];
      for (let i = 0; i < 32; i++) {
        idle.push(
          await run(`(() => {
            const s = window.__petDebug.state();
            const w = window.__petDebug.sway();
            return s.bounds ? [s.bounds.y, s.bounds.h, s.bounds.x, s.bounds.w, w.deg, w.lift] : null;
          })()`)
        );
        await wait(120);
      }
      const cols = [0, 1, 2, 3, 4].map((c) => idle.filter(Boolean).map((r) => r[c]));
      const span = cols.map((v) => (v.length ? Number((Math.max(...v) - Math.min(...v)).toFixed(2)) : null));
      console.log(
        '[idle] 幅度 y/h/x/w/倾角(度) = ' + JSON.stringify(span) + ' 帧数 ' + idle.filter(Boolean).length
      );

      // 顺手留两张不同相位的图，肉眼比对"她到底晃没晃"
      try {
        const a = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.cwd(), 'sway-a.png'), a.toPNG());
        await wait(2100);
        const b = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.cwd(), 'sway-b.png'), b.toPNG());
      } catch (err) {
        console.error('[idle] 截图失败', err);
      }

      // 2) 坐下后底边出框随时间的曲线
      await run(`window.__petDebug.mood('sit')`);
      const t0 = Date.now();
      const trace = [];
      for (let i = 0; i < 26; i++) {
        const bottom = await run(`(() => {
          const b = window.__petDebug.state().bounds;
          return b ? b.y + b.h : null;
        })()`);
        trace.push([Date.now() - t0, bottom === null ? null : Math.round(bottom)]);
        await wait(80);
      }
      console.log('[sit] 底边轨迹 ' + JSON.stringify(trace));

      app.exit(0);
    }, 3200);
  }

  /**
   * Interact 到底是个什么动作？
   *
   * 想拿它当「她自己动一下」用，得先看清楚：要是"被戳到缩一下"那种反应，
   * 无端播出来就很怪。每 260ms 截一帧，连起来看。
   */
  if (process.env.PET_ACT_PROBE === '1') {
    setTimeout(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      // 先用小数位量一次待机：确认 Default 是不是真的不动
      const raw = [];
      const faces = new Set();
      for (let i = 0; i < 20; i++) {
        raw.push(await win.webContents.executeJavaScript(`window.__petDebug.rawBounds()`));
        const f = await win.webContents.executeJavaScript(`window.__petDebug.faces()`);
        if (Array.isArray(f)) faces.add(f.join('|'));
        await wait(110);
      }
      const ys = raw.filter(Boolean).map((b) => b.y);
      const hs = raw.filter(Boolean).map((b) => b.h);
      console.log(
        '[idle] y ' +
          Math.min(...ys).toFixed(2) +
          '~' +
          Math.max(...ys).toFixed(2) +
          '  h ' +
          Math.min(...hs).toFixed(2) +
          '~' +
          Math.max(...hs).toFixed(2) +
          '  表情组合 ' +
          faces.size
      );
      if (faces.size > 1) console.log('[idle] 表情变化: ' + JSON.stringify([...faces].slice(0, 4)));
      else console.log('[idle] 表情: ' + JSON.stringify([...faces][0] || ''));

      await win.webContents.executeJavaScript(`window.__petDebug.playOnce('interact')`);
      for (let i = 0; i < 7; i++) {
        await wait(260);
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(process.cwd(), `act-${i}.png`), img.toPNG());
        } catch (err) {
          console.error('[act] 截图失败', err);
        }
      }
      console.log('[act] done');

      // 图集里有 F_Eye / F_Eye_2 / F_Eye_3 / F_Eye_4，原本想找一张闭眼做眨眼。
      // 逐张挂上去看过：四张都是睁眼变体（不同瞳色/高光），没有闭合帧，
      // 所以眨眼做不了，只能靠微动。--faces 可以复核这件事
      await wait(1200);
      for (const name of ['F_Eye_2', 'F_Eye_3', 'F_Eye_4', 'F_Eye']) {
        await win.webContents.executeJavaScript(`window.__petDebug.attach('F_Eye', '${name}')`);
        await wait(300);
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(process.cwd(), `eye-${name}.png`), img.toPNG());
        } catch (err) {
          console.error('[eye] 截图失败', err);
        }
      }
      console.log('[eye] done');
      app.exit(0);
    }, 3200);
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

  refreshTray();
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.showInactive();
    refreshTray();
  });
}

/** 换装子菜单：素材缺了就不列出，一套都没有时给一句提示而不是空菜单 */
function outfitSubmenu() {
  const list = availableOutfits();
  if (!list.length) {
    return [{ label: '（没有可用素材）', enabled: false }];
  }
  return list.map((o) => ({
    label: o.name,
    type: 'radio',
    checked: Boolean(currentOutfit && currentOutfit.id === o.id),
    click: () => applyOutfit(o.id),
  }));
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? '让她休息（隐藏）' : '叫她出来（显示）',
      click: () => {
        if (!win) return;
        if (win.isVisible()) {
          win.hide();
        } else {
          win.showInactive();
        }
        refreshTray();
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
      label: '换装',
      submenu: outfitSubmenu(),
    },
    {
      label: '静音（只显示文字）',
      type: 'checkbox',
      checked: muted,
      click: (item) => {
        muted = item.checked;
        // 存下来：开会时静音，重启后又开始说话，这种事只会发生一次
        settings.set('muted', muted);
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
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(buildTrayMenu());
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
 * 时装
 * ------------------------------------------------------------------ */

/**
 * 渲染层启动时来问"我现在该穿哪套、还有哪些能换"。
 * 路径由主进程拼，渲染层不自己拼文件名——和语音一样的理由，
 * 名字只在一处定义，换素材不会改漏。
 */
ipcMain.handle('pet:outfits', () => ({
  current: currentOutfit ? publicOutfit(currentOutfit) : null,
  list: availableOutfits().map(publicOutfit),
}));

/** 渲染层也能主动切换（目前只有托盘走，留着给以后的快捷键/双击衣橱） */
ipcMain.handle('pet:set-outfit', (_event, id) => {
  applyOutfit(String(id));
  return currentOutfit ? publicOutfit(currentOutfit) : null;
});

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
  muted = Boolean(settings.get('muted'));
  resolveOutfit();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
