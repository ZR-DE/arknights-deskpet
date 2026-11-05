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
const WIN_HEIGHT = 520;
const EDGE_MARGIN = 16;

let win = null;
let tray = null;
let ignoringMouse = true;
let dragOrigin = null;
let companion = null;

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

  win.on('closed', () => {
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[load-fail]', code, desc);
  });

  if (process.env.PET_SMOKE === '1') {
    setTimeout(async () => {
      try {
        const diag = await win.webContents.executeJavaScript(`(() => {
          if (window.__diag) return window.__diag;
          const b = document.getElementById('layer-body');
          const e = document.getElementById('layer-eyes');
          const r = document.getElementById('pet').getBoundingClientRect();
          return {
            body: b.src.split('/').slice(-2).join('/'),
            bodySize: b.naturalWidth + 'x' + b.naturalHeight,
            eyesHidden: e.classList.contains('missing'),
            petRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            bubble: document.getElementById('bubble').className,
          };
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
