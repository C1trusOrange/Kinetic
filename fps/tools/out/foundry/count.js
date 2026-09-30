const m = (await import('/src/world/maps/foundry.js')).default;
const s = m.solids, c = {};
for (const x of s) c[x.type] = (c[x.type] || 0) + 1;
const bad = [344, 346].map(i => i + ':' + JSON.stringify(s[i]));
return { n: s.length, c, bad };
