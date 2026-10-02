"""menu suite: hosting on an online server through the Multiplayer screens (tools/mp/menu_online.js).

Online server switch shows the address + host key fields; no address -> an error in the card; wrong key and no key
-> back on the hub with the matching message; the right key (pasted with spaces) -> the lobby on that server with
the address for friends; the built-in server of this PC never starts; settings remember server, key and choice;
the server keeps its rooms unlisted; Lock room makes the relay refuse a stranger's join, Unlock undoes it.
"""


def check(pages, ctx):
    if len(pages) != 1:
        return [f'{len(pages)} pages, want 1']
    r = ctx.report(pages[0])
    if not r:
        return ['no result (window.__MENU__)']
    if not r.get('ok'):
        return [f'the menu test stopped: {r.get("error")}']
    s = r['steps']
    fails = []

    def want(cond, text):
        if not cond:
            fails.append(text)

    want(s['hub']['screen'] == 'mp' and s['hub']['where'] and not s['hub']['online'], f'hub: {s["hub"]}')
    want(s['switched']['online'] and s['switched']['setting'] == 'online' and 'online server' in s['switched']['text'],
         f'switch to Online server: {s["switched"]}')
    want(s['noAddr']['screen'] == 'mp' and 'address' in s['noAddr']['err'], f'no address: {s["noAddr"]}')
    want(s['wrongKey']['setup'] == 'setup' and 'did not accept your host key' in s['wrongKey']['msg'], f'wrong key: {s["wrongKey"]}')
    want('needs a host key' in s['noKey']['msg'], f'no key: {s["noKey"]}')
    lobby = s['lobby']
    srv = s['saved']['server']
    want(lobby['role'] == 'host' and lobby['online'] is True and lobby['server'] == f'http://{srv}', f'lobby: {lobby}')
    want(srv in lobby['addr'] and lobby['code'] in lobby['addr'] and 'no port forwarding' in lobby['addr'], f'lobby address text: {lobby["addr"]!r}')
    want(s['saved']['key'] is True and s['saved']['hostOn'] == 'online', f'saved settings: {s["saved"]}')
    want(s['lockShown'] == 'Lock room', f'lock button: {s["lockShown"]!r}')
    lk = s['locked']
    want(lk['flag'] is True and lk['label'] == 'Unlock room' and 'Locked' in lk['addr'] and lk['stranger'] == 'room-locked',
         f'locked room: {lk}')
    want(s['unlocked'] == {'flag': False, 'label': 'Lock room'}, f'unlocked room: {s["unlocked"]}')
    want(s['left']['screen'] == 'mp', f'after leaving: {s["left"]}')
    want(s['list'] == {'rooms': [], 'listed': False}, f'room list of the online server: {s["list"]}')
    want(r.get('started') == 0, f'the built-in server was started {r.get("started")} time(s)')
    want(not s['back']['online'] and s['back']['setting'] == 'pc', f'back to This PC: {s["back"]}')
    for k in ('wrongKey', 'noKey'):
        ctx.log(f'{k}: {s[k]["msg"]}')
    ctx.log(f'lobby: {lobby["addr"]}')
    return fails
