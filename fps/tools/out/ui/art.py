from sess import Session
s = Session(1280, 720)
s.goto('tools/out/ui/harness.html', 'window.__READY')
s.run("""
document.querySelector('.s-setup').remove(); const m = await import('/src/ui/Icons.js');
const d = document.createElement('div');
d.style.cssText = 'position:fixed;inset:0;background:#0b1420;z-index:99;padding:20px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px';
const defs = [
 {id:'foundry', colors:['#1d2b4a','#ff9a3c']}, {id:'skyline', colors:['#2a1442','#ff4fa3']}, {id:'ruins', colors:['#5a4a1d','#ffd27a']},
 {id:'sandbox', colors:['#1a8f7a','#1b2a35']}, {id:'foundry', colors:['#0d2038','#3de0ff']}, {id:'ruins', colors:['#3a1a10','#ff6a2a']},
];
for (const def of defs) d.innerHTML += `<div style="height:300px;position:relative;overflow:hidden">${m.mapArt(def)}</div>`;
document.body.appendChild(d);
d.querySelectorAll('svg').forEach(v => { v.style.width='100%'; v.style.height='100%'; });
""")
s.wait(0.5)
s.shot('art.png')
s.close()
