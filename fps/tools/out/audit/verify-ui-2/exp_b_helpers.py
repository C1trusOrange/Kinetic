import time

def new_match(s, bots, score, mode='ffa', timelim=0):
    s.run(f"""
      __GAME__.startMatch({{mapId:'sandbox', mode:'{mode}', botCount:{bots}, difficulty:'easy', scoreLimit:{score}, timeLimit:{timelim}}});
    """, timeout=120)
    t0 = time.time()
    while time.time() - t0 < 150:
        s.wait(0.5)
        try:
            if s.js("__GAME__.state") == 'playing' and s.js("__GAME__.match && __GAME__.match.scoreLimit") == score: break
        except Exception:
            pass
    s.wait(1.2)
