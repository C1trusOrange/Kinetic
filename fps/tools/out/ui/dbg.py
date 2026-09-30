from sess import Session
s = Session(1280, 720)
s.goto('tools/out/ui/harness.html', 'window.__READY')
r = s.run("""
const m = await import('/src/ui/Icons.js');
const html = m.mapArt({id:'foundry', colors:['#1d2b4a','#ff9a3c']});
return html.slice(0, 1500);
""")
print(r)
s.close()
