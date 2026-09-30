import math, random, statistics
random.seed(1)
def sim(d, ang, n=20000, pattern=False):
    tr = math.tan(ang)
    res = []
    for _ in range(n):
        hits = 0
        for i in range(9):
            if pattern:
                # 1 centre + 8 ring at 0.7 r with per-pellet jitter 0.25 r, whole pattern rotated randomly
                if i == 0: r, a = 0.0, 0.0
                else:
                    r, a = 0.7, (i - 1) / 8 * 2 * math.pi
                rot = 0  # fixed rotation per shot handled below
                r = tr * r + tr * 0.22 * random.random()
                a += rot + random.uniform(-0.25, 0.25)
                x, y = r * d * math.cos(a), r * d * math.sin(a)
            else:
                r = tr * math.sqrt(random.random()) * (0.6 + 0.4 * random.random())
                a = random.random() * 2 * math.pi
                x, y = r * d * math.cos(a), r * d * math.sin(a)
            if abs(x) < 0.38 and abs(y) < 0.62: hits += 1
        res.append(hits)
    m = statistics.mean(res); sd = statistics.pstdev(res)
    p_ge7 = sum(1 for h in res if h >= 7) / n
    p_le3 = sum(1 for h in res if h <= 3) / n
    return round(m, 2), round(sd, 2), round(p_ge7 * 100), round(p_le3 * 100)
print("dist  random(mean,sd,P>=7,P<=3)   pattern(mean,sd,P>=7,P<=3)   [hip ang 0.055]")
for d in (4, 6, 8, 10, 12, 15):
    print(d, sim(d, 0.055), sim(d, 0.055, pattern=True))
print("ADS ang 0.038")
for d in (6, 8, 10, 12, 15):
    print(d, sim(d, 0.038), sim(d, 0.038, pattern=True))
