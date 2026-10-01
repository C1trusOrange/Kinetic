/**
 * KINETIC desktop shell: runs the browser game (index.html, src/, vendor/) in an Electron window.
 *
 * Why a desktop build: a browser tab reserves keys and buttons a shooter needs (Ctrl+W closes the tab, the side
 * mouse buttons navigate back / forward), and a folder with KINETIC.exe is easier to hand to friends than
 * "install Python, run play.bat".
 *
 * The game files are served from the app folder over a private `kinetic://game/` scheme (no HTTP server, no port,
 * no firewall prompt). It is registered as a secure, standard origin, so ES modules, fetch and pointer lock behave
 * as on http://localhost, and the origin never changes between runs (localStorage settings persist).
 *
 * The window has no menu, so no browser accelerators exist (Ctrl+W / Ctrl+R / F5 / zoom do nothing) and every
 * key reaches the game. F11 toggles fullscreen; F12 opens DevTools in an unpackaged run (npm start).
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, protocol, shell } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const SCHEME = 'kinetic';
const HOST = 'game';
const ORIGIN = `${SCHEME}://${HOST}`;

/** Only these may be served (the rest of the folder holds tools, docs and test output). */
const PUBLIC_FILES = new Set(['index.html', 'style.css']);
const PUBLIC_DIRS = new Set(['src', 'vendor', 'music']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// Laptops with integrated + dedicated graphics: render on the dedicated GPU.
app.commandLine.appendSwitch('force_high_performance_gpu');

/** The file a kinetic://game/... request maps to, or null when it is outside the public game files. */
function resolveRequest(url) {
  if (url.host !== HOST) return null;
  let rel;
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (rel === '') rel = 'index.html';
  const file = path.resolve(ROOT, rel);
  const parts = path.relative(ROOT, file).split(path.sep);
  if (parts[0] === '..' || path.isAbsolute(parts[0])) return null;
  const allowed = parts.length === 1 ? PUBLIC_FILES.has(parts[0]) : PUBLIC_DIRS.has(parts[0]);
  return allowed ? file : null;
}

async function serve(request) {
  const file = resolveRequest(new URL(request.url));
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    title: 'KINETIC',
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',   // menu music may start before the first click
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // The game is the only page: never navigate away from it, never open other windows (web links go to the browser).
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.code === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.code === 'F12' && !app.isPackaged) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();   // KINETIC is already open: the running copy brings its window forward (second-instance below)
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle(SCHEME, serve);
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
