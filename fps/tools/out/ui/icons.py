from sess import Session
s = Session(1280, 720)
s.goto('tools/out/ui/harness.html', 'window.__READY')
s.run("""
const m = await import('/src/ui/Icons.js');
const d = document.createElement('div');
d.style.cssText = 'position:fixed;inset:0;background:#0b1420;z-index:99;padding:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;color:#dfeaf3;font:12px sans-serif';
const ids = ['pistol','rifle','shotgun','sniper','rocket','grenade','melee','fall','explosion'];
for (const id of ids) d.innerHTML += `<div style="background:#111d2c;padding:8px"><div style="width:260px">${m.weaponIcon(id)}</div>${id}</div>`;
for (const k of Object.keys(m.ICON)) d.innerHTML += `<div style="background:#111d2c;padding:8px"><div style="width:48px;height:48px">${m.ICON[k]}</div>${k}</div>`;
document.body.appendChild(d);
d.querySelectorAll('svg').forEach(v => { if (v.classList.contains('w-ico')) { v.style.width='260px'; v.style.height='91px'; } else { v.style.width='48px'; v.style.height='48px'; } });
""")
s.wait(0.5)
s.shot('icons.png')
s.close()
