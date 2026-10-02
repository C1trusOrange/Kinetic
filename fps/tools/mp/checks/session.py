"""session suite (tools/mp/scenarios/session.js).

A client with another build is refused with reason 'build'. A client whose link freezes for 4 s is soft-dropped
by the host within 2.6 s of the freeze, restored within 0.5 s of it ending, without a death; another client sees
its avatar hidden and then visible again.
"""


def _c(page):
    rep = page.get('result') or {}
    return rep.get('custom') or {}


def check(pages, ctx):
    fails = []
    refused = [p for p in pages if (ctx.net(p).get('joinError'))]
    if not refused:
        fails.append('no page was refused')
    for p in refused:
        err = ctx.net(p).get('joinError')
        ctx.log(f'p{p["page"]} refused: {err} (closed: {ctx.net(p).get("closed")})')
        if err != 'build':
            fails.append(f'p{p["page"]} refused with {err!r}, want build')
    host = next((p for p in pages if ctx.role(p) == 'host'), None)
    frozen = next((p for p in pages if (_c(p).get('session') or {}).get('freeze')), None)
    if not host or not frozen:
        return fails + ['need the host and the frozen client']
    hs = _c(host)['session']
    fz = _c(frozen)['session']['freeze']
    fid = _c(frozen).get('entityId')
    drops = [d for d in hs['drops'] if d[0] == fid]
    restores = [d for d in hs['restores'] if d[0] == fid]
    if not drops:
        fails.append(f'the host never held entity {fid} out of play during its freeze')
    else:
        d = drops[0][1] - fz['at']
        ctx.log(f'soft drop {d} ms after the freeze began (deaths {drops[0][2]})')
        if not (2400 <= d <= 2700):
            fails.append(f'soft drop {d} ms after the freeze (want 2500 +- 100..200)')
    if not restores:
        fails.append(f'entity {fid} was never restored')
    else:
        r = restores[0][1] - (fz['at'] + fz['ms'])
        ctx.log(f'restored {r} ms after the freeze ended')
        if r > 500:
            fails.append(f'restored {r} ms after the freeze ended (> 500)')
    deaths = dict((i, d) for i, d in _c(host).get('remoteDeaths') or [])
    if deaths.get(fid):
        fails.append(f'entity {fid} has {deaths[fid]} death(s): the freeze counted as a death')
    others = [p for p in pages if p is not frozen and ctx.role(p) == 'client' and not ctx.net(p).get('joinError')]
    for p in others:
        s = _c(p).get('session') or {}
        hid = [x for x in s.get('seenHidden', []) if x[0] == fid]
        visb = [x for x in s.get('seenVisible', []) if x[0] == fid]
        ctx.log(f'p{p["page"]} saw {fid} hidden at {hid[:1]} and visible at {visb[:1]}')
        if not hid or not visb:
            fails.append(f'p{p["page"]}: did not see entity {fid} hidden and visible again')
    return fails
