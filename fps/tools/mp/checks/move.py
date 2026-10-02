"""move suite: what each machine shows of the other humans vs where they really were (tools/mp/scenarios/move.js).

Each page logs `self` [hostMs, x, y, z, alive] (its own player, stamped with the host time it simulated that state)
and `seen` {id: [[shownHostMs, x, y, z]]} (the other humans as shown, stamped with the host time the shown state
belongs to). For every viewer -> target pair the shown positions are compared with the target's own track at the same
host time. Samples within 0.3 s of a spawn are skipped (the snap is intended).
"""
import bisect
import math

LIMITS = {
    # viewer role -> (p95 m, max m) at 60 Hz on loopback / LAN
    'host': (0.20, 0.60),
    'client': (0.15, 0.80),
}
SPAWN_SKIP_MS = 300


def _track(page):
    rep = page.get('result') or {}
    return ((rep.get('custom') or {}).get('track')) or None


def _at(times, self_track, t):
    """The owner's position at host time t (linear between the two nearest samples), or None outside its track."""
    i = bisect.bisect_left(times, t)
    if i <= 0 or i >= len(times):
        return None
    a, b = self_track[i - 1], self_track[i]
    if not a[4] or not b[4]:
        return None
    span = b[0] - a[0]
    if span <= 0 or span > 200:
        return None
    k = (t - a[0]) / span
    return (a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k)


def check(pages, ctx):
    fails = []
    owners = {}
    for p in pages:
        tr = _track(p)
        if tr and tr.get('me'):
            owners[int(tr['me'])] = (p, tr)
    if len(owners) < 2:
        return ['fewer than two pages reported a track']
    pairs = 0
    for p in pages:
        tr = _track(p)
        if not tr:
            continue
        role = ctx.role(p)
        lim_p95, lim_max = LIMITS.get(role, LIMITS['client'])
        for tid, shown in (tr.get('seen') or {}).items():
            owner = owners.get(int(tid))
            if not owner:
                continue
            _, otr = owner
            self_track = otr.get('self') or []
            times = [s[0] for s in self_track]
            spawns = [s[0] for s in (otr.get('spawns') or []) if s[1] == int(tid)]
            errs = []
            for t, x, y, z in shown:
                if any(0 <= t - st < SPAWN_SKIP_MS for st in spawns):
                    continue
                pos = _at(times, self_track, t)
                if pos is None:
                    continue
                errs.append(math.dist(pos, (x, y, z)))
            if len(errs) < 20:
                fails.append(f'p{p["page"]} ({role}) -> entity {tid}: only {len(errs)} comparable samples')
                continue
            pairs += 1
            p95 = ctx.percentile(errs, 0.95)
            mx = max(errs)
            mean = sum(errs) / len(errs)
            ctx.log(f'p{p["page"]} ({role}) sees {tid}: n={len(errs)} mean={mean:.3f} p95={p95:.3f} max={mx:.3f} m'
                    f' (limits p95 {lim_p95}, max {lim_max})')
            if p95 > lim_p95:
                fails.append(f'p{p["page"]} -> {tid}: p95 error {p95:.3f} m > {lim_p95}')
            if mx > lim_max:
                fails.append(f'p{p["page"]} -> {tid}: max error {mx:.3f} m > {lim_max}')
    if not pairs:
        fails.append('no viewer -> target pairs to compare')
    # snapshot rate on every client >= 90 % of min(snapshot rate, host simulation rate)
    host = next((p for p in pages if ctx.role(p) == 'host'), None)
    sim = (ctx.net(host).get('simHz') or 60) if host else 60
    for p in pages:
        c = ctx.net(p).get('client')
        if not c:
            continue
        want = 0.9 * min(c.get('snapHz') or 60, sim)
        ctx.log(f'p{p["page"]} snapshots {c.get("snapHzEff")} Hz (want >= {want:.1f}), interp delay {c.get("interpDelayMs")}, '
                f'lag p95 {c.get("lagP95")} ms, jitter {c.get("jitter")} ms')
        if (c.get('snapHzEff') or 0) < want:
            fails.append(f'p{p["page"]}: snapshot rate {c.get("snapHzEff")} Hz < {want:.1f}')
    if host:
        ctx.log(f'host simHz {ctx.net(host).get("simHz")}')
        if (ctx.net(host).get('simHz') or 0) < 55:
            fails.append(f'host simHz {ctx.net(host).get("simHz")} < 55')
    return fails
