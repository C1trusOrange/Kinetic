/**
 * KINETIC desktop shell: runs the browser game (index.html, src/, vendor/) in an Electron window.
 *
 * Why a desktop build: a browser tab reserves keys and buttons a shooter needs (Ctrl+W closes the tab, the side
 * mouse buttons navigate back / forward), and a folder with KINETIC.exe is easier to hand to friends than
 * "install Python, run play.bat".
 *
 * The game files (index.html, style.css, src/, vendor/, music/, fonts/) are served from the app folder over a private `kinetic://game/` scheme (no HTTP server, no port,
 * no firewall prompt). It is registered as a secure, standard origin, so ES modules, fetch and pointer lock behave
 * as on http://localhost, and the origin never changes between runs (localStorage settings persist).
 *
 * The window has no menu, so no browser accelerators exist (Ctrl+W / Ctrl+R / F5 / zoom do nothing) and every
 * key reaches the game. F11 toggles fullscreen; F12 opens DevTools in an unpackaged run (npm start).
 *
 * Multiplayer is a listen server: when a player hosts, the game asks this process (window.kineticDesktop, see
 * preload.js) to start the relay (relay.js: room codes + packet routing) on a TCP port of every network interface,
 * and friends connect to <this PC's address>:<port> with the room code. The relay runs until the game stops it
 * or the app quits. The page reaches it over plain ws:// and http:// (to 127.0.0.1 and to LAN or internet addresses)
 * with no webPreferences relaxed: Chromium does not treat those as mixed content for this secure custom scheme
 * (checked by desktop/selftest.js), and the relay answers CORS for the origin kinetic://game and accepts it on /ws.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, protocol, shell } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const SCHEME = 'kinetic';
const HOST = 'game';
const ORIGIN = `${SCHEME}://${HOST}`;
/** `KINETIC_SELFTEST=1 npx electron .` runs desktop/selftest.js against the real window and exits; never in a packaged app. */
const SELFTEST = !app.isPackaged && process.env.KINETIC_SELFTEST === '1';
const SELFTEST_PAGE = '/__selftest__.html';
// the self-test runs beside a real KINETIC (its own single-instance lock) and leaves the player's saved settings alone
if (SELFTEST) app.setPath('userData', path.join(app.getPath('temp'), 'kinetic-selftest'));

/** Only these may be served (the rest of the folder holds tools, docs and test output). */
const PUBLIC_FILES = new Set(['index.html', 'style.css']);
const PUBLIC_DIRS = new Set(['src', 'vendor', 'music', 'fonts']);

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
  const url = new URL(request.url);
  if (SELFTEST && url.host === HOST && url.pathname === SELFTEST_PAGE) {
    // an empty page on the game's own origin: what the self-test needs without loading the whole game
    return new Response('<!doctype html><meta charset="utf-8"><title>KINETIC selftest</title>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const file = resolveRequest(url);
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.promises.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// ------------------------------------------------------------------------------------------------ multiplayer server

const DEFAULT_RELAY_PORT = 27500;

let relay = null;          // the built-in server while a player hosts
let relayPort = 0;
let relayStarting = null;  // a start in flight: a second call waits for it instead of binding twice
let quitting = false;

function relayStatus() {
  if (!relay) return { running: false, port: 0, ips: [], urls: [] };
  const info = relay.lanInfo();
  return { running: true, port: relayPort, ips: info.ips, urls: info.urls };
}

function parsePort(value) {
  if (value === undefined || value === null) return DEFAULT_RELAY_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Object.assign(new Error(`Invalid port: ${value}`), { code: 'EINVAL' });
  return port;
}

/**
 * Start the relay on every network interface (once: a running relay is returned as it is, whatever port is asked
 * for, so the caller reads the port from the result). Rejects with the listen error (EADDRINUSE ...).
 */
function startRelay(port) {
  if (relay) return Promise.resolve(relayStatus());
  if (relayStarting) return relayStarting;
  const { createRelay } = require('./relay');
  relayStarting = (async () => {
    const candidate = createRelay({
      log: app.isPackaged ? null : text => console.log(`[relay] ${text}`),   // room events show in the dev console only
      errorLog: text => console.error(text),
    });
    try {
      const bound = await candidate.listen({ host: '0.0.0.0', port });
      relay = candidate;
      relayPort = bound.port;
      return relayStatus();
    } catch (err) {
      await candidate.close().catch(() => {});
      throw err;
    } finally {
      relayStarting = null;
    }
  })();
  return relayStarting;
}

async function stopRelay() {
  if (relayStarting) await relayStarting.catch(() => {});
  const running = relay;
  relay = null;
  relayPort = 0;
  if (running) await running.close();
}

/** IPC from the game window only (never a sub-frame, never another origin). */
function fromGamePage(event) {
  const frame = event.senderFrame;
  return !!frame && frame === event.sender.mainFrame && frame.url.startsWith(ORIGIN + '/');
}

function registerIpc() {
  const reply = fn => async (event, arg) => {
    if (!fromGamePage(event)) return { ok: false, code: 'EPERM', message: 'Not allowed.' };
    try {
      return { ok: true, ...(await fn(arg || {})) };
    } catch (err) {
      const { listenErrorText } = require('./relay');
      const port = err && err.port !== undefined ? err.port : (arg && arg.port) || DEFAULT_RELAY_PORT;
      const known = err && (err.code === 'EADDRINUSE' || err.code === 'EACCES');
      return { ok: false, code: (err && err.code) || 'EFAIL', message: known ? listenErrorText(err, port) : String((err && err.message) || err) };
    }
  };
  ipcMain.handle('relay:start', reply(opts => startRelay(parsePort(opts.port))));
  ipcMain.handle('relay:stop', reply(async () => {
    await stopRelay();
    return {};
  }));
  ipcMain.handle('relay:status', reply(async () => relayStatus()));
}

// ------------------------------------------------------------------------------------------------ window

/** `hidden`: no visible window (the self-test); `page`: path to load on the game's origin. */
function createWindow({ hidden = false, page = '/index.html' } = {}) {
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
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--kinetic-version=${app.getVersion()}`],   // the sandboxed preload cannot read package.json
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',   // menu music may start before the first click
    },
  });

  if (!hidden) {
    win.once('ready-to-show', () => {
      win.maximize();
      win.show();
    });
  }

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

  win.loadURL(`${ORIGIN}${page}`);
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
    registerIpc();
    if (SELFTEST) {
      // unpackaged + KINETIC_SELFTEST=1 only (see SELFTEST): drive the real window and server, print, exit
      require('./selftest').run(createWindow({ hidden: true, page: SELFTEST_PAGE })).then(code => app.exit(code), err => {
        console.error(err);
        app.exit(1);
      });
      return;
    }
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());

  // the server must not outlive the app (it holds a port and every player's connection)
  app.on('before-quit', event => {
    if (quitting || !relay) return;
    event.preventDefault();
    quitting = true;
    stopRelay().catch(() => {}).finally(() => app.quit());
  });
}
