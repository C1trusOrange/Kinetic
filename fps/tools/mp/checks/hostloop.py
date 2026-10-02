"""hostloop suite (tools/mp/scenarios/hostloop.js; run with --hide 0:<T>:5).

Hidden host: its game time advances >= 4.5 s during a 5 s minimized window, the client keeps receiving >= 50
snapshots/s, the bots keep moving (>= 5 m). Host hitch (400 ms busy loop): game time advances <= real time + 20 ms
across it and the frames after it follow real time (no catch-up burst). Client freeze (2 s): the host soft-drops nobody.
"""


def _log(page):
    rep = page.get('result') or {}
    return ((rep.get('custom') or {}).get('hostloop')) or None


def check(pages, ctx):
    fails = []
    host = next((p for p in pages if ctx.role(p) == 'host'), None)
    client = next((p for p in pages if ctx.role(p) == 'client'), None)
    if not host or not client:
        return ['need a host and a client page']
    hl, cl = _log(host), _log(client)
    if not hl or not cl:
        return ['a page has no hostloop log']
    hidden = [s for s in hl['s'] if s[2]]
    if not hidden:
        fails.append('the host page was never hidden (run with --hide 0:<T>:5)')
    else:
        t_a, t_b = hidden[0][0], hidden[-1][0]
        g_a, g_b = hidden[0][1], hidden[-1][1]
        span = (t_b - t_a) / 1000
        adv = g_b - g_a
        ctx.log(f'host hidden {span:.2f} s (host time), game time advanced {adv:.2f} s, {len(hidden)} samples')
        if span < 4.0:
            fails.append(f'hidden window only {span:.2f} s')
        elif adv < span - 0.5:
            fails.append(f'host game time advanced {adv:.2f} s in {span:.2f} s hidden')
        bd = hidden[-1][6] - hidden[0][6]
        ctx.log(f'bots moved {bd:.1f} m while the host was hidden')
        if bd < 5:
            fails.append(f'bots moved only {bd:.1f} m while the host was hidden')
        inside = [s for s in cl['s'] if t_a <= s[0] <= t_b]
        if len(inside) >= 2:
            snaps = inside[-1][4] - inside[0][4]
            rate = snaps / max(1e-3, (inside[-1][0] - inside[0][0]) / 1000)
            ctx.log(f'client received {rate:.1f} snapshots/s while the host was hidden')
            if rate < 50:
                fails.append(f'client got {rate:.1f} snapshots/s while the host was hidden (< 50)')
        else:
            fails.append('no client samples inside the hidden window')
    hb = hl.get('busy')
    if not hb:
        fails.append('host busy loop did not run')
    else:
        real = (hb['endPerf'] - hb['startPerf']) / 1000
        after = hl.get('after') or []
        first = next((a for a in after if a[1] > hb['frame']), None)
        if first:
            adv = first[2] - hb['gameTime']
            gap = (first[0] + (hb['endPerf'] - hb['startPerf'])) / 1000
            ctx.log(f'host hitch {real * 1000:.0f} ms: game time +{adv:.3f} s at the first frame after (real {gap:.3f} s)')
            if adv > gap + 0.02:
                fails.append(f'game time ran ahead across the hitch: +{adv:.3f} s in {gap:.3f} s')
        # no catch-up burst: after the first frame, game time follows real time (any display rate)
        if first:
            win = [a for a in after if first[0] <= a[0] <= first[0] + 20]
            if len(win) >= 2:
                g_adv = (win[-1][2] - win[0][2]) * 1000
                r_adv = win[-1][0] - win[0][0]
                ctx.log(f'next {r_adv:.1f} ms after the hitch: {len(win)} frames, game time +{g_adv:.1f} ms')
                if g_adv > r_adv + 5:
                    fails.append(f'catch-up burst after the hitch: game time +{g_adv:.1f} ms in {r_adv:.1f} ms')
    cb = cl.get('busy')
    if not cb:
        fails.append('client busy loop did not run')
    rep = host.get('result') or {}
    drops = (rep.get('custom') or {}).get('softDrops')
    ever = (rep.get('custom') or {}).get('softDropWarned')
    ctx.log(f'host soft drops: now {drops}, ever {ever}')
    if ever:
        fails.append('the host soft-dropped a client during its 2 s freeze')
    # the client's interpolation delay settles again within 5 s of its own freeze
    if cb:
        tail = [s for s in cl['s'] if s[0] > cb['hostMs'] + 5000]
        if tail:
            ctx.log(f'client interp delay 5 s after its freeze: {tail[0][5]} ms')
            if tail[0][5] > 100:
                fails.append(f'client interp delay still {tail[0][5]} ms 5 s after its freeze')
    return fails
