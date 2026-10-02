'use strict';
/**
 * Sets up (or updates) the KINETIC online server from this PC: copies the relay and the installer to the server
 * over SSH and runs the installer there (server/install.sh). Run it from the fps folder:
 *
 *   node server/deploy.js root@203.0.113.7                                   relay on TCP 27500
 *   node server/deploy.js root@203.0.113.7 --domain play.example.com --email you@example.com      HTTPS on 443
 *   node server/deploy.js root@203.0.113.7 --uninstall
 *
 * Every option after the address goes to install.sh (bash install.sh --help lists them). Own options:
 *   --ssh-port N     the server's SSH port (default 22)
 *   --identity FILE  an SSH private key (ssh -i)
 *   --dry-run        print what would run, change nothing
 *
 * It uses the ssh / scp programs of this PC (Windows 10 and 11 have them: Settings > System > Optional features >
 * OpenSSH Client). With a password login, SSH asks for it twice: once to copy, once to run the installer.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const FILES = [
  [path.join(HERE, '..', 'desktop', 'relay.js'), 'relay.js'],
  [path.join(HERE, 'install.sh'), 'install.sh'],
  [path.join(HERE, 'kinetic-relay.service'), 'kinetic-relay.service'],
];
const TARGET_RE = /^(?:[A-Za-z0-9._-]+@)?(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/;

const USAGE = `Usage: node server/deploy.js [user@]server [--ssh-port N] [--identity FILE] [--dry-run] [install.sh options]
  e.g. node server/deploy.js root@203.0.113.7
       node server/deploy.js root@203.0.113.7 --domain play.example.com --email you@example.com
  (install.sh options: --domain, --email, --port, --list-rooms, --new-key, --no-domain, --uninstall)`;

/** A word for a POSIX shell: single-quoted, with any ' closed, escaped and reopened. */
function shQuote(s) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** argv -> {target, sshPort, identity, dryRun, rest} or {error} / {help}. */
function parseArgs(argv) {
  const out = { target: '', sshPort: '', identity: '', dryRun: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--ssh-port' || a === '--identity') {
      const v = argv[++i];
      if (!v) return { error: `${a} needs a value` };
      if (a === '--ssh-port') {
        if (!/^\d{1,5}$/.test(v) || +v < 1 || +v > 65535) return { error: `bad --ssh-port: ${v}` };
        out.sshPort = v;
      } else out.identity = v;
    } else if (!out.target && !a.startsWith('-')) out.target = a;
    else out.rest.push(a);
  }
  if (!out.target) return { error: 'which server? (user@address)' };
  if (!TARGET_RE.test(out.target)) return { error: `"${out.target}" is not user@address` };
  if (!out.target.includes('@')) out.target = 'root@' + out.target;
  return out;
}

/** Copy the files into a fresh folder under `parent`, with LF line endings (a Windows checkout may have CRLF). */
function stage(parent, name) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir);
  for (const [src, dst] of FILES) {
    if (!fs.existsSync(src)) throw new Error(`missing ${path.relative(process.cwd(), src)}`);
    const text = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(path.join(dir, dst), text, { mode: dst.endsWith('.sh') ? 0o755 : 0o644 });
  }
  return dir;
}

/** The commands deploy runs: [{cmd, args, cwd}], plus the staged folder's name. */
function plan(o, stagedParent, name) {
  const common = [];
  if (o.identity) common.push('-i', o.identity);
  const remoteDir = `/tmp/${name}`;
  const install = `"${remoteDir}/install.sh"${o.rest.length ? ' ' + o.rest.map(shQuote).join(' ') : ''}`;
  const remote = `if [ "$(id -u)" -eq 0 ]; then bash ${install}; else sudo bash ${install}; fi; rc=$?; rm -rf "${remoteDir}"; exit $rc`;
  return [
    // a relative source: scp would read "C:\\..." as a host named C
    { cmd: 'scp', args: [...common, ...(o.sshPort ? ['-P', o.sshPort] : []), '-r', name, `${o.target}:/tmp/`], cwd: stagedParent },
    { cmd: 'ssh', args: [...common, ...(o.sshPort ? ['-p', o.sshPort] : []), '-t', o.target, remote], cwd: stagedParent },
  ];
}

function main(argv) {
  const o = parseArgs(argv);
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  if (o.error) {
    console.error(`${o.error}\n\n${USAGE}`);
    return 2;
  }
  const name = `kinetic-relay-${crypto.randomBytes(4).toString('hex')}`;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kinetic-deploy-'));
  try {
    stage(parent, name);
    const steps = plan(o, parent, name);
    if (o.dryRun) {
      console.log(`Staged ${FILES.map(f => f[1]).join(', ')} in ${path.join(parent, name)}`);
      for (const s of steps) console.log(`${s.cmd} ${s.args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
      return 0;
    }
    for (const tool of ['ssh', 'scp']) {
      const r = spawnSync(tool, ['-V'], { stdio: 'ignore' });
      if (r.error && r.error.code === 'ENOENT') {
        console.error(`${tool} is not installed. Windows: Settings > System > Optional features > Add a feature > "OpenSSH Client".`);
        return 1;
      }
    }
    console.log(`Copying the relay and the installer to ${o.target} ...`);
    for (const s of steps) {
      const r = spawnSync(s.cmd, s.args, { stdio: 'inherit', cwd: s.cwd });
      if (r.error) {
        console.error(`${s.cmd} failed: ${r.error.message}`);
        return 1;
      }
      if (r.status !== 0) {
        console.error(s.cmd === 'scp'
          ? `\nCould not copy the files (scp exit ${r.status}). Check the address, the SSH port and the password / key.`
          : `\nThe installer stopped (exit ${r.status}): its message is above.`);
        return r.status || 1;
      }
      if (s.cmd === 'scp') console.log('Running the installer on the server ...');
    }
    return 0;
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

module.exports = { parseArgs, plan, shQuote, stage };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
