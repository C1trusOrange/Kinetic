/**
 * The online server built into a copy of the game: desktop/server.json, {"server": "play.example.com"}, written into a
 * build by `npm run package -- --server ...` (desktop/package.js) or kept next to this file by hand (git ignores it).
 * main.js hands it to the page (window.kineticDesktop.defaultServer), whose Join screen starts with it, so friends
 * only type the room code. See server/README.md.
 */
const fs = require('node:fs');
const path = require('node:path');

/** What may be built in: an address as typed in the game (host, host:port or a URL), nothing that needs escaping. */
const SERVER_RE = /^[\w.:/[\]-]{1,200}$/;

/**
 * The built-in server of the copy whose desktop/ folder is `dir`: '' when there is no server.json, or it is broken or
 * holds something that is not a plausible address.
 * @param {string} [dir]
 * @returns {string}
 */
function readDefaultServer(dir = __dirname) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(dir, 'server.json'), 'utf8'));
  } catch {
    return '';
  }
  const s = cfg && typeof cfg.server === 'string' ? cfg.server.trim() : '';
  return SERVER_RE.test(s) ? s : '';
}

module.exports = { readDefaultServer, SERVER_RE };
