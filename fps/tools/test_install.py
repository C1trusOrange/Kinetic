#!/usr/bin/env python3
"""Tests for the online server installer (server/install.sh), run on this PC against a stand-in machine.

    python tools/test_install.py [-v] [-k Domain]

install.sh has a test mode: KINETIC_TEST_ROOT is a directory standing in for / (every file it writes lands under
it). The system commands it calls (apt-get, apt-cache, systemctl, ufw, ss, ip, getent, journalctl, curl, gpg,
caddy, id) are stubs on PATH that log each call and keep a little state (firewall rules, which program holds which
port, whether the service runs). Node.js is the real one. Bash: Git Bash on Windows, /bin/bash elsewhere.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
SERVER = os.path.join(ROOT, 'server')
RELAY_JS = os.path.join(ROOT, 'desktop', 'relay.js')
MARK = '# KINETIC relay: written by install.sh'


def find_bash():
    if os.name == 'nt':
        for c in (os.environ.get('KINETIC_BASH'), r'C:\Program Files\Git\bin\bash.exe', r'C:\Program Files\Git\usr\bin\bash.exe'):
            if c and os.path.isfile(c):
                return c
        return None
    return shutil.which('bash')


BASH = find_bash()
NODE = shutil.which('node')


def sh_path(p):
    """A path as bash sees it (Git Bash: /c/Users/...)."""
    p = os.path.abspath(p)
    if os.name != 'nt':
        return p
    drive, rest = os.path.splitdrive(p)
    return '/' + drive[0].lower() + rest.replace('\\', '/')


STUBS = {
    'id': r'''
echo "id $*" >> "$STUB_STATE/calls.log"
if [ "${1:-}" = -u ]; then echo "${STUB_UID:-0}"; exit 0; fi
exec /usr/bin/id "$@"
''',
    'apt-get': r'''
echo "apt-get $*" >> "$STUB_STATE/calls.log"
case " $* " in *" install "*)
  for a in "$@"; do
    case "$a" in
      nodejs) mkdir -p "$KINETIC_TEST_ROOT/usr/bin"
              printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$REAL_NODE" > "$KINETIC_TEST_ROOT/usr/bin/node"
              chmod +x "$KINETIC_TEST_ROOT/usr/bin/node" ;;
      caddy) printf '#!/usr/bin/env bash\necho "caddy $*" >> "$STUB_STATE/calls.log"\nexit 0\n' > "$STUB_BIN/caddy"
             chmod +x "$STUB_BIN/caddy" ;;
    esac
  done ;;
esac
exit 0
''',
    'apt-cache': r'''
echo "apt-cache $*" >> "$STUB_STATE/calls.log"
if [ "$1" = policy ]; then
  case "$2" in
    nodejs) printf 'nodejs:\n  Installed: (none)\n  Candidate: %s\n' "${STUB_NODE_CANDIDATE:-20.19.2+dfsg-1}" ;;
    caddy) printf 'caddy:\n  Installed: (none)\n  Candidate: %s\n' "${STUB_CADDY_CANDIDATE:-2.6.2-6}" ;;
  esac
fi
exit 0
''',
    'curl': r'''
echo "curl $*" >> "$STUB_STATE/calls.log"
out=""; prev=""
for a in "$@"; do if [ "$prev" = -o ]; then out="$a"; fi; prev="$a"; done
if [ -n "$out" ]; then printf 'echo "nodesource-setup ran" >> "$STUB_STATE/calls.log"\n' > "$out"; else echo "stub download"; fi
exit 0
''',
    'gpg': r'''
echo "gpg $*" >> "$STUB_STATE/calls.log"
out=""; prev=""
for a in "$@"; do if [ "$prev" = -o ]; then out="$a"; fi; prev="$a"; done
mkdir -p "$(dirname "$out")"; cat > "$out"
''',
    'systemctl': r'''
echo "systemctl $*" >> "$STUB_STATE/calls.log"
relay_port() { sed -n 's/.*--port \([0-9]*\).*/\1/p' "$KINETIC_TEST_ROOT/etc/kinetic-relay/relay.env" 2>/dev/null; }
free_owner() { for f in "$STUB_STATE"/port_*; do [ -f "$f" ] && [ "$(cat "$f")" = "$1" ] && rm -f "$f"; done; return 0; }
case "$1" in
  is-active) [ -f "$STUB_STATE/active" ] && exit 0; exit 3 ;;
  restart|start)
    if [ "$2" = kinetic-relay ]; then free_owner node; touch "$STUB_STATE/active"; echo node > "$STUB_STATE/port_$(relay_port)"; fi
    if [ "$2" = caddy ]; then echo caddy > "$STUB_STATE/port_80"; echo caddy > "$STUB_STATE/port_443"; fi ;;
  disable)
    case " $* " in *" kinetic-relay "*) rm -f "$STUB_STATE/active"; free_owner node ;; esac
    case " $* " in *" caddy "*) free_owner caddy ;; esac ;;
esac
exit 0
''',
    'ufw': r'''
echo "ufw $*" >> "$STUB_STATE/calls.log"
rules="$STUB_STATE/ufw.rules"; touch "$rules"
case "$1" in
  status)
    if [ "${STUB_UFW:-active}" = active ]; then
      printf 'Status: active\n\nTo                         Action      From\n--                         ------      ----\n'
      while read -r r; do printf '%-26s ALLOW       Anywhere\n' "$r"; done < "$rules"
    else echo 'Status: inactive'; fi ;;
  allow) if grep -qxF "$2" "$rules"; then echo 'Skipping adding existing rule'; else echo "$2" >> "$rules"; echo 'Rule added'; fi ;;
  --force) if [ "$2" = delete ] && [ "$3" = allow ]; then grep -vxF "$4" "$rules" > "$rules.tmp" || true; mv "$rules.tmp" "$rules"; fi ;;
esac
exit 0
''',
    'ss': r'''
echo "ss $*" >> "$STUB_STATE/calls.log"
all="$*"
port="${all##*:}"
if [ -f "$STUB_STATE/port_$port" ]; then
  printf 'LISTEN 0 511 0.0.0.0:%s 0.0.0.0:* users:(("%s",pid=42,fd=3))\n' "$port" "$(cat "$STUB_STATE/port_$port")"
fi
exit 0
''',
    'ip': r'''
echo "ip $*" >> "$STUB_STATE/calls.log"
case "$*" in
  *"route get"*) echo "1.1.1.1 via 203.0.113.1 dev eth0 src ${STUB_IP:-203.0.113.7} uid 0"; echo "    cache" ;;
  *"addr show"*) echo "2: eth0    inet ${STUB_IP:-203.0.113.7}/24 brd 203.0.113.255 scope global eth0\       valid_lft forever" ;;
esac
exit 0
''',
    'getent': r'''
echo "getent $*" >> "$STUB_STATE/calls.log"
dns="${STUB_DNS-203.0.113.7}"
[ -n "$dns" ] || exit 2
for a in $dns; do printf '%s       STREAM %s\n%s       DGRAM\n' "$a" "$2" "$a"; done
''',
    'journalctl': r'''
echo "journalctl $*" >> "$STUB_STATE/calls.log"
echo "(stub journal)"
''',
}

OS_RELEASE = {
    'ubuntu': 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nNAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n',
    'debian': 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nID=debian\n',
    'alma': 'PRETTY_NAME="AlmaLinux 9.4"\nNAME="AlmaLinux"\nID="almalinux"\nID_LIKE="rhel centos fedora"\n',
}

STOCK_CADDYFILE = """# The Caddyfile is an easy way to configure your Caddy web server.
#
# To use your own domain name (with automatic HTTPS), first make
# sure your domain's A/AAAA DNS records are properly pointed to
# this machine's public IP, then replace ":80" below with your
# domain name.

:80 {
\t# Set this path to your site's directory.
\troot * /usr/share/caddy

\t# Enable the static file server.
\tfile_server

\t# Another common task is to set up a reverse proxy:
\t# reverse_proxy localhost:8080
}

# Refer to the Caddy docs for more information:
# https://caddyserver.com/docs/caddyfile
"""


class Machine:
    """A stand-in server: a root directory, stub commands and their state."""

    def __init__(self, os_name='ubuntu', node=True, caddy=False):
        self.dir = tempfile.mkdtemp(prefix='kinetic-install-')
        self.root = os.path.join(self.dir, 'root')
        self.bin = os.path.join(self.dir, 'bin')
        self.state = os.path.join(self.dir, 'state')
        self.pkg = os.path.join(self.dir, 'pkg')          # what server/deploy.js uploads
        for d in (self.root, self.bin, self.state, self.pkg, self.path('etc'), self.path('usr/share/keyrings'),
                  self.path('etc/apt/sources.list.d')):
            os.makedirs(d, exist_ok=True)
        self.write('etc/os-release', OS_RELEASE[os_name])
        for name, body in STUBS.items():
            self._exe(os.path.join(self.bin, name), body)
        if node:
            self.install_node()
        if caddy:
            self._exe(os.path.join(self.bin, 'caddy'), 'echo "caddy $*" >> "$STUB_STATE/calls.log"\nexit 0\n')
        for f in ('install.sh', 'kinetic-relay.service'):
            shutil.copy(os.path.join(SERVER, f), self.pkg)
        shutil.copy(RELAY_JS, self.pkg)
        self.env = {}

    def _exe(self, path, body):
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write('#!/usr/bin/env bash\n' + body.lstrip('\n'))
        os.chmod(path, 0o755)

    def install_node(self):
        os.makedirs(self.path('usr/bin'), exist_ok=True)
        self._exe(self.path('usr/bin/node'), f'exec "{sh_path(NODE)}" "$@"\n')

    def path(self, rel):
        return os.path.join(self.root, *rel.split('/'))

    def write(self, rel, text):
        os.makedirs(os.path.dirname(self.path(rel)), exist_ok=True)
        with open(self.path(rel), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)

    def read(self, rel):
        with open(self.path(rel), encoding='utf-8') as f:
            return f.read()

    def exists(self, rel):
        return os.path.exists(self.path(rel))

    def hold_port(self, port, program):
        with open(os.path.join(self.state, f'port_{port}'), 'w', encoding='utf-8') as f:
            f.write(program)

    def ufw_rules(self):
        p = os.path.join(self.state, 'ufw.rules')
        return open(p, encoding='utf-8').read().split() if os.path.exists(p) else []

    def calls(self):
        p = os.path.join(self.state, 'calls.log')
        return open(p, encoding='utf-8').read().splitlines() if os.path.exists(p) else []

    def clear_calls(self):
        p = os.path.join(self.state, 'calls.log')
        if os.path.exists(p):
            os.remove(p)

    def run(self, *args):
        env = dict(os.environ)
        env.pop('KINETIC_HOST_KEY', None)
        env.update({
            'KINETIC_TEST_ROOT': sh_path(self.root), 'STUB_STATE': sh_path(self.state), 'STUB_BIN': sh_path(self.bin),
            'REAL_NODE': sh_path(NODE),
        })
        if os.name == 'nt':
            # Git Bash converts a Windows PATH (C:\...;C:\...) to its own form when it starts: hand it one
            git = os.path.dirname(os.path.dirname(BASH)) if BASH.lower().endswith(r'\bin\bash.exe') else os.path.dirname(BASH)
            git = git[:-4] if git.lower().endswith(r'\usr') else git
            env['PATH'] = ';'.join([self.bin, os.path.join(git, 'usr', 'bin'), os.path.join(git, 'bin'), os.path.join(git, 'mingw64', 'bin')])
            env['MSYS_NO_PATHCONV'] = '1'
        else:
            env['PATH'] = f'{self.bin}:/usr/bin:/bin'
        env.update(self.env)
        # Git's bash.exe puts its own directories first in PATH: the stubs go in front from inside bash
        cmd = [BASH, '-c', 'PATH="$STUB_BIN:$PATH"; export PATH; exec bash "$0" "$@"', sh_path(os.path.join(self.pkg, 'install.sh')), *args]
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
        return r.returncode, r.stdout, r.stderr

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)


@unittest.skipIf(BASH is None, 'no bash (Git Bash on Windows)')
@unittest.skipIf(NODE is None, 'node is not on PATH')
class InstallCase(unittest.TestCase):
    machine_kw = {}

    def setUp(self):
        self.m = Machine(**self.machine_kw)

    def tearDown(self):
        self.m.close()

    def install(self, *args, ok=True):
        code, out, err = self.m.run(*args)
        if ok:
            self.assertEqual(code, 0, f'install.sh {" ".join(args)} failed:\n{out}\n{err}')
        else:
            self.assertNotEqual(code, 0, f'install.sh {" ".join(args)} should have failed:\n{out}')
        return out, err

    def env_file(self):
        out = {}
        for line in self.m.read('etc/kinetic-relay/relay.env').splitlines():
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                out[k] = v
        return out

    def conf(self):
        return dict(line.split('=', 1) for line in self.m.read('etc/kinetic-relay/install.conf').splitlines() if '=' in line)

    def key(self):
        return self.m.read('etc/kinetic-relay/host-key').strip()


class PlainTests(InstallCase):
    def test_fresh_install(self):
        out, _ = self.install()
        with open(RELAY_JS, encoding='utf-8') as f:
            self.assertEqual(self.m.read('opt/kinetic-relay/relay.js'), f.read())
        key = self.key()
        self.assertRegex(key, r'^[A-HJ-NP-Za-km-z2-9]{24}$')
        env = self.env_file()
        self.assertEqual(env['KINETIC_HOST_KEY'], key)
        self.assertEqual(env['KINETIC_RELAY_ARGS'], '--host 0.0.0.0 --port 27500 --no-room-list --no-lan-info')
        unit = self.m.read('etc/systemd/system/kinetic-relay.service')
        self.assertIn('ExecStart=/usr/bin/node /opt/kinetic-relay/relay.js $KINETIC_RELAY_ARGS', unit)
        self.assertIn('EnvironmentFile=/etc/kinetic-relay/relay.env', unit)
        self.assertIn('DynamicUser=yes', unit)
        self.assertFalse(self.m.exists('etc/systemd/system/kinetic-relay.service.d'))
        self.assertEqual(self.conf(), {'PORT': '27500', 'DOMAIN': '', 'EMAIL': '', 'LIST': '0', 'OPENED': '27500/tcp'})
        self.assertEqual(self.m.ufw_rules(), ['27500/tcp'])
        calls = self.m.calls()
        self.assertIn('systemctl daemon-reload', calls)
        self.assertIn('systemctl enable --quiet kinetic-relay', calls)
        self.assertIn('systemctl restart kinetic-relay', calls)
        self.assertFalse(any(c.startswith('apt-get') for c in calls), 'Node.js was there: nothing to install')
        self.assertIn('Server address   203.0.113.7:27500', out)
        self.assertIn(f'Host key         {key}   (new)', out)
        self.assertIn('npm run package -- --server 203.0.113.7:27500', out)
        self.assertNotIn(MARK, self.m.read('etc/os-release'))
        self.assertFalse(self.m.exists('etc/caddy/Caddyfile'))

    def test_rerun_keeps_the_key_and_the_options(self):
        self.install('--port', '27600', '--list-rooms')
        key = self.key()
        self.m.clear_calls()
        out, _ = self.install()                                  # an update: no options given
        self.assertEqual(self.key(), key)
        self.assertNotIn('(new)', out)
        self.assertEqual(self.env_file()['KINETIC_RELAY_ARGS'], '--host 0.0.0.0 --port 27600 --no-lan-info')
        self.assertEqual(self.conf()['OPENED'], '27600/tcp')
        self.assertIn('Firewall (ufw): 27600/tcp is open', out)
        self.assertEqual(self.m.ufw_rules(), ['27600/tcp'])
        self.install('--no-list-rooms')
        self.assertIn('--no-room-list', self.env_file()['KINETIC_RELAY_ARGS'])

    def test_new_key(self):
        self.install()
        old = self.key()
        out, _ = self.install('--new-key')
        self.assertNotEqual(self.key(), old)
        self.assertEqual(self.env_file()['KINETIC_HOST_KEY'], self.key())
        self.assertIn('(new)', out)

    def test_moving_the_port_closes_the_old_rule(self):
        self.install()
        self.install('--port', '27600')
        self.assertEqual(self.m.ufw_rules(), ['27600/tcp'])
        self.assertEqual(self.conf()['OPENED'], '27600/tcp')

    def test_a_rule_that_was_there_is_not_ours(self):
        with open(os.path.join(self.m.state, 'ufw.rules'), 'w', encoding='utf-8') as f:
            f.write('27500/tcp\n')
        self.install()
        self.assertEqual(self.conf()['OPENED'], '')
        self.install('--uninstall')
        self.assertEqual(self.m.ufw_rules(), ['27500/tcp'])         # the owner's rule stays

    def test_low_port_gets_the_bind_capability(self):
        self.install('--port', '443')
        dropin = self.m.read('etc/systemd/system/kinetic-relay.service.d/port.conf')
        self.assertIn('AmbientCapabilities=CAP_NET_BIND_SERVICE', dropin)
        self.install('--port', '27500')
        self.assertFalse(self.m.exists('etc/systemd/system/kinetic-relay.service.d'))

    def test_port_held_by_another_program_changes_nothing(self):
        self.m.hold_port(27500, 'java')
        _, err = self.install(ok=False)
        self.assertIn("port 27500 is already in use by 'java'", err)
        self.assertFalse(self.m.exists('opt/kinetic-relay'))
        self.assertFalse(self.m.exists('etc/kinetic-relay'))
        self.assertEqual(self.m.ufw_rules(), [])

    def test_our_running_relay_is_not_a_conflict(self):
        self.install()
        self.assertTrue(os.path.exists(os.path.join(self.m.state, 'port_27500')))   # the stub service holds it
        self.install()

    def test_bad_options(self):
        for args, text in ((['--port', '0'], '--port must be'), (['--port', '70000'], '--port must be'), (['--port', 'x'], '--port must be'),
                           (['--domain', 'not a domain'], '--domain must be'), (['--domain', '203.0.113.7'], '--domain must be'),
                           (['--domain', 'a.example', '--email', 'nope'], '--email must be'), (['--frobnicate'], 'unknown option'),
                           (['--port'], '--port needs a value'), (['--domain', 'a.example', '--no-domain'], 'make no sense'),
                           (['--domain', 'a.example', '--port', '443'], 'Caddy takes ports 80 and 443')):
            _, err = self.install(*args, ok=False)
            self.assertIn(text, err, args)
        self.assertFalse(self.m.exists('opt/kinetic-relay'))

    def test_root_only(self):
        self.m.env['STUB_UID'] = '1000'
        _, err = self.install('--port', '27600', ok=False)
        self.assertIn('run it as root: sudo bash', err)
        self.assertIn('--port 27600', err)

    def test_help(self):
        out, _ = self.install('--help')
        self.assertIn('sudo bash install.sh --domain play.example.com', out)
        self.assertNotIn('set -euo', out)

    def test_no_firewall(self):
        self.m.env['STUB_UFW'] = 'inactive'
        out, _ = self.install()
        self.assertIn('no ufw / firewalld active', out)
        self.assertEqual(self.conf()['OPENED'], '')

    def test_private_address_warns(self):
        self.m.env['STUB_IP'] = '10.0.0.5'
        _, err = self.install()
        self.assertIn('private one', err)

    def test_uninstall(self):
        self.install()
        out, _ = self.install('--uninstall')
        for rel in ('opt/kinetic-relay', 'etc/kinetic-relay', 'etc/systemd/system/kinetic-relay.service'):
            self.assertFalse(self.m.exists(rel), rel)
        self.assertEqual(self.m.ufw_rules(), [])
        self.assertIn('systemctl disable --now kinetic-relay', self.m.calls())
        self.assertIn('removed', out)


class OsTests(InstallCase):
    machine_kw = {'os_name': 'alma'}

    def test_not_debian(self):
        _, err = self.install(ok=False)
        self.assertIn('for Debian or Ubuntu', err)
        self.assertIn('AlmaLinux', err)


class DebianTests(InstallCase):
    machine_kw = {'os_name': 'debian'}

    def test_debian_is_fine(self):
        self.install()


class NodeFromDistroTests(InstallCase):
    machine_kw = {'node': False}

    def test_distro_node_when_new_enough(self):
        out, _ = self.install()
        calls = self.m.calls()
        self.assertTrue(any(c.startswith('apt-get') and c.endswith('install nodejs') for c in calls), calls)
        self.assertFalse(any('nodesource' in c for c in calls))
        self.assertIn('Node.js v', out)

    def test_nodesource_when_the_distro_one_is_old(self):
        self.m.env['STUB_NODE_CANDIDATE'] = '18.19.1+dfsg-6ubuntu5'
        out, _ = self.install()
        calls = self.m.calls()
        self.assertTrue(any('https://deb.nodesource.com/setup_24.x' in c for c in calls), calls)
        self.assertIn('nodesource-setup ran', calls)
        self.assertIn('installing Node.js 24 from NodeSource', out)

    def test_epoch_in_the_version(self):
        self.m.env['STUB_NODE_CANDIDATE'] = '1:22.11.0-1'
        self.install()
        self.assertFalse(any('nodesource' in c for c in self.m.calls()))


class DomainTests(InstallCase):
    def test_https_with_caddy(self):
        out, err = self.install('--domain', 'Play.Example.com', '--email', 'me@example.com')
        env = self.env_file()
        self.assertEqual(env['KINETIC_RELAY_ARGS'],
                         '--host 127.0.0.1 --port 27500 --trust-proxy --allow-host play.example.com --no-room-list --no-lan-info')
        caddy = self.m.read('etc/caddy/Caddyfile')
        self.assertTrue(caddy.startswith(MARK), caddy)
        self.assertIn('{\n\temail me@example.com\n}', caddy)
        self.assertIn('play.example.com {', caddy)
        self.assertIn('@relay path /ws /api/rooms', caddy)
        self.assertIn('reverse_proxy 127.0.0.1:27500', caddy)
        calls = self.m.calls()
        self.assertTrue(any(c.startswith('apt-get') and c.endswith('install caddy') for c in calls), calls)
        self.assertIn('caddy validate --config ' + sh_path(self.m.path('etc/caddy/Caddyfile')) + ' --adapter caddyfile', calls)
        self.assertIn('systemctl restart caddy', calls)
        self.assertEqual(sorted(self.m.ufw_rules()), ['443/tcp', '80/tcp'])
        self.assertEqual(self.conf()['OPENED'], '80/tcp 443/tcp')
        self.assertIn('DNS: play.example.com -> 203.0.113.7 (this server)', out)
        self.assertIn('Server address   play.example.com', out)
        self.assertIn('npm run package -- --server play.example.com', out)
        self.assertIn('it must allow TCP 80 and 443', out)

    def test_from_plain_to_domain_and_back(self):
        self.install()
        key = self.key()
        self.install('--domain', 'play.example.com')
        self.assertEqual(self.key(), key)
        self.assertEqual(sorted(self.m.ufw_rules()), ['443/tcp', '80/tcp'])       # the plain port is closed again
        self.install()                                                          # an update keeps the domain
        self.assertIn('--trust-proxy', self.env_file()['KINETIC_RELAY_ARGS'])
        self.m.clear_calls()
        out, _ = self.install('--no-domain')
        self.assertEqual(self.env_file()['KINETIC_RELAY_ARGS'], '--host 0.0.0.0 --port 27500 --no-room-list --no-lan-info')
        self.assertFalse(self.m.exists('etc/caddy/Caddyfile'))
        self.assertIn('systemctl disable --now caddy', self.m.calls())
        self.assertEqual(self.m.ufw_rules(), ['27500/tcp'])
        self.assertIn('Removed the KINETIC site from Caddy', out)

    def test_stock_caddyfile_is_kept_aside_and_restored(self):
        self.m.write('etc/caddy/Caddyfile', STOCK_CADDYFILE)
        self.install('--domain', 'play.example.com')
        self.assertEqual(self.m.read('etc/caddy/Caddyfile.before-kinetic'), STOCK_CADDYFILE)
        self.install('--domain', 'play.example.com')                           # a re-run does not back up our own file
        self.assertEqual(self.m.read('etc/caddy/Caddyfile.before-kinetic'), STOCK_CADDYFILE)
        self.install('--uninstall')
        self.assertEqual(self.m.read('etc/caddy/Caddyfile'), STOCK_CADDYFILE)

    def test_an_owners_caddyfile_is_never_touched(self):
        mine = 'shop.example.com {\n\treverse_proxy 127.0.0.1:3000\n}\n'
        self.m.write('etc/caddy/Caddyfile', mine)
        _, err = self.install('--domain', 'play.example.com', ok=False)
        self.assertIn('already serves other sites', err)
        self.assertEqual(self.m.read('etc/caddy/Caddyfile'), mine)
        self.assertFalse(self.m.exists('opt/kinetic-relay'))

    def test_web_ports_held_by_another_program(self):
        self.m.hold_port(443, 'nginx')
        _, err = self.install('--domain', 'play.example.com', ok=False)
        self.assertIn("port 443 is in use by 'nginx'", err)
        self.assertIn('Run without --domain instead', err)
        self.assertFalse(self.m.exists('opt/kinetic-relay'))

    def test_relay_on_443_moves_behind_caddy(self):
        self.install('--port', '443')
        self.install('--domain', 'play.example.com')
        self.assertIn('--port 27500', self.env_file()['KINETIC_RELAY_ARGS'])
        self.assertFalse(self.m.exists('etc/systemd/system/kinetic-relay.service.d'))

    def test_dns_not_pointing_here(self):
        self.m.env['STUB_DNS'] = '198.51.100.9'
        _, err = self.install('--domain', 'play.example.com')
        self.assertIn('points to 198.51.100.9', err)
        self.m.env['STUB_DNS'] = ''
        _, err = self.install('--domain', 'play.example.com')
        self.assertIn('does not resolve yet', err)

    def test_caddy_from_its_own_repository(self):
        self.m.env['STUB_CADDY_CANDIDATE'] = '(none)'
        self.install('--domain', 'play.example.com')
        calls = self.m.calls()
        self.assertTrue(any('dl.cloudsmith.io/public/caddy/stable/gpg.key' in c for c in calls), calls)
        self.assertTrue(self.m.exists('usr/share/keyrings/caddy-stable-archive-keyring.gpg'))
        self.assertTrue(self.m.exists('etc/apt/sources.list.d/caddy-stable.list'))


class CaddyPresentTests(InstallCase):
    machine_kw = {'caddy': True}

    def test_an_installed_caddy_is_used(self):
        self.install('--domain', 'play.example.com')
        self.assertFalse(any(c.endswith('install caddy') for c in self.m.calls()))


class UnitFileTests(unittest.TestCase):
    def test_the_unit_is_hardened(self):
        with open(os.path.join(SERVER, 'kinetic-relay.service'), encoding='utf-8') as f:
            unit = f.read()
        for line in ('DynamicUser=yes', 'NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'CapabilityBoundingSet=\n',
                     'Restart=always', 'WantedBy=multi-user.target'):
            self.assertIn(line, unit)
        self.assertNotIn('MemoryDenyWriteExecute', unit)       # V8's JIT needs writable + executable memory
        self.assertRegex(unit, re.compile(r'^ExecStart=/usr/bin/node /opt/kinetic-relay/relay.js \$KINETIC_RELAY_ARGS$', re.M))


if __name__ == '__main__':
    unittest.main()
