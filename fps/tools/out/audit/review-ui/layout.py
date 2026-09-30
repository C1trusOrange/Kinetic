import sys, json
from sess import Session
size = sys.argv[1] if len(sys.argv) > 1 else '1280x720'
w, h = (int(v) for v in size.split('x'))
s = Session(w, h)
s.goto('index.html', "window.__GAME__ && window.__GAME__.state === 'menu'", timeout=180)
s.wait(1.5)
print('fontsize', s.js("getComputedStyle(document.querySelector('.k-menu')).fontSize"))
measure = """(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = [];
  const sc = document.querySelector('.k-screen.on');
  const scr = sc ? sc.getBoundingClientRect() : null;
  for (const el of document.querySelectorAll('.k-screen.on *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom > vh + 1 || r.right > vw + 1 || r.left < -1 || r.top < -1) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      out.push([el.tagName + '.' + (el.className && el.className.baseVal === undefined ? el.className : '') + (el.dataset ? (el.dataset.act || el.dataset.r || '') : ''), Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]);
    }
  }
  const foot = document.querySelector('.k-screen.on .k-foot');
  const fb = foot ? foot.getBoundingClientRect() : null;
  const opts = document.querySelector('.k-screen.on .setup-opts');
  const ob = opts ? opts.getBoundingClientRect() : null;
  return {vw, vh, overflow: out.slice(0, 25), foot: fb && [fb.top, fb.bottom], opts: ob && [ob.top, ob.bottom], scrollH: sc && sc.scrollHeight, clientH: sc && sc.clientHeight};
})()"""
for name in ['main', 'setup', 'settings', 'controls']:
    s.run(f"__GAME__.menu._go('{name}');")
    s.wait(0.8)
    print(name, json.dumps(s.js(measure)))
    s.shot(f'layout_{name}_{w}x{h}.png')
s.close()
