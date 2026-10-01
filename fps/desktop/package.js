/**
 * Builds the shareable Windows copy of KINETIC:
 *
 *   npm run package    ->  dist/KINETIC-win32-x64/KINETIC.exe  +  dist/KINETIC-win32-x64.zip
 *
 * Friends unzip it anywhere and run KINETIC.exe (no install, no Python). Windows SmartScreen warns the first time
 * because the exe is not code-signed: "More info" > "Run anyway".
 *
 * Only the game itself goes into the build, trimmed to what it uses:
 *   - index.html, style.css, src/, fonts/, music/*.ogg (the .wav masters stay behind) and the desktop shell (main.js,
 *     preload.js and relay.js, the built-in multiplayer server; not selftest.js),
 *   - from vendor/three only the files the game imports (three.module.js + the addons reached from src/) + LICENSE,
 *   - of Chromium's ~55 UI locales only en-US (the game has no browser UI that would use them).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { packager } = require('@electron/packager');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const NAME = 'KINETIC';

/** Top-level entries copied into the app (everything else is left out). */
const APP_FILES = new Set(['package.json', 'desktop', 'index.html', 'style.css', 'src', 'vendor', 'music', 'fonts']);
/** Files of desktop/ that stay out of the build: development tools (main.js only loads selftest.js when unpackaged). */
const DEV_ONLY = new Set(['desktop/selftest.js']);
const THREE_MAIN = 'vendor/three/build/three.module.js';
const THREE_ADDONS = 'vendor/three/examples/jsm/';
const KEEP_LOCALES = new Set(['en-US.pak']);

const IMPORT_RE = /(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]*\s*from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** vendor/ files (ROOT-relative, forward slashes) reachable through the imports of src/ (+ vendor/three/LICENSE). */
function usedVendorFiles() {
  const used = new Set(['vendor/three/LICENSE']);
  const queue = [];
  const rel = abs => path.relative(ROOT, abs).split(path.sep).join('/');
  const add = r => {
    if (used.has(r) || !fs.existsSync(path.join(ROOT, r))) return;
    used.add(r);
    queue.push(r);
  };
  const resolve = (spec, fromRel) => {
    if (spec === 'three') return THREE_MAIN;
    if (spec.startsWith('three/addons/')) return THREE_ADDONS + spec.slice('three/addons/'.length);
    if (spec.startsWith('.') && fromRel.startsWith('vendor/')) return rel(path.resolve(ROOT, path.dirname(fromRel), spec));
    return null;   // src/ -> src/ imports (all of src/ ships anyway) or absolute test paths
  };
  const scan = r => {
    const text = fs.readFileSync(path.join(ROOT, r), 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const target = resolve(m[1] || m[2], r);
      if (target && target.startsWith('vendor/')) add(target);
    }
  };
  for (const f of walk(path.join(ROOT, 'src'))) scan(rel(f));
  add(THREE_MAIN);   // index.html's import map
  while (queue.length) scan(queue.shift());
  return used;
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const vendor = usedVendorFiles();
  const vendorDirs = new Set();
  for (const f of vendor) for (let d = path.posix.dirname(f); d !== '.'; d = path.posix.dirname(d)) vendorDirs.add(d);

  // `p` is relative to ROOT with a leading slash ('' for the root itself); true = leave it out
  const ignore = p => {
    if (p === '') return false;
    const r = p.slice(1);
    const top = r.split('/')[0];
    if (!APP_FILES.has(top) || DEV_ONLY.has(r)) return true;
    if (top === 'vendor') return !(vendor.has(r) || vendorDirs.has(r));
    if (top === 'music') return r !== 'music' && !r.endsWith('.ogg');
    return false;
  };

  const [appDir] = await packager({
    dir: ROOT,
    out: OUT,
    name: NAME,
    executableName: NAME,
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    asar: true,
    prune: true,
    appVersion: pkg.version,
    win32metadata: { ProductName: NAME, FileDescription: NAME, CompanyName: NAME },
    ignore,
  });

  const locales = path.join(appDir, 'locales');
  for (const f of fs.readdirSync(locales)) if (!KEEP_LOCALES.has(f)) fs.rmSync(path.join(locales, f));

  const zip = `${appDir}.zip`;
  fs.rmSync(zip, { force: true });
  // Windows' own bsdtar writes zip archives (-a picks the format from the extension)
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', zip, '-C', path.dirname(appDir), path.basename(appDir)], { stdio: 'inherit' });

  const mb = n => `${(n / 1048576).toFixed(1)} MB`;
  console.log(`\nBuilt ${path.relative(ROOT, appDir)}\\${NAME}.exe (${vendor.size} vendor files)`);
  console.log(`Zip for friends: ${path.relative(ROOT, zip)} (${mb(fs.statSync(zip).size)})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
