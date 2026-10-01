/**
 * Preload of the game window: exposes `window.kineticDesktop` to the page (contextBridge; the page itself has no
 * Node and no ipcRenderer). It is the only way the game reaches the built-in multiplayer server that desktop/main.js
 * runs when a player hosts (desktop/relay.js):
 *
 *   kineticDesktop.isDesktop                  true
 *   kineticDesktop.version                    the app version (package.json)
 *   kineticDesktop.startServer({port})        -> Promise<{running, port, ips, urls}>; starts the server on every network
 *                                                interface (default port 27500), or returns the one already running (its
 *                                                `port` is the truth, whatever port was asked for). Rejects with an Error
 *                                                whose message is written for players and can be shown as it is, e.g. "Port
 *                                                27500 is already in use. Close the other program, or use another port."
 *                                                (match /in use/i). contextBridge hands the page only an Error's message and
 *                                                stack: a `code` property set here would not arrive, so there is none.
 *   kineticDesktop.stopServer()               -> Promise<void>
 *   kineticDesktop.serverStatus()             -> Promise<{running, port, ips, urls}>
 *
 * The window is sandboxed, so this file may require 'electron' only (contextBridge, ipcRenderer): it stays
 * self-contained, and the version arrives as a command-line argument added by main.js (additionalArguments).
 */
const { contextBridge, ipcRenderer } = require('electron');

const VERSION_ARG = '--kinetic-version=';
const versionArg = process.argv.find(a => a.startsWith(VERSION_ARG));
const version = versionArg ? versionArg.slice(VERSION_ARG.length) : '';

/**
 * Invoke a main-process handler. Handlers answer {ok: true, ...data} or {ok: false, code, message}: a failure
 * becomes a rejected promise with an Error carrying just the message (ipcRenderer.invoke would wrap it in "Error
 * invoking remote method ...").
 */
async function call(channel, arg) {
  const reply = await ipcRenderer.invoke(channel, arg);
  if (!reply || reply.ok !== true) {
    throw new Error((reply && reply.message) || 'The KINETIC server could not be started.');
  }
  const { ok, ...data } = reply;
  return data;
}

contextBridge.exposeInMainWorld('kineticDesktop', {
  isDesktop: true,
  version,
  startServer(opts) {
    const port = opts && opts.port !== undefined && opts.port !== null ? Number(opts.port) : undefined;
    return call('relay:start', { port });
  },
  async stopServer() {
    await call('relay:stop');
  },
  serverStatus() {
    return call('relay:status');
  },
});
