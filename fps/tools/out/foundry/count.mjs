import def from '../../../src/world/maps/foundry.js';
const s = def.solids;
const c = {};
for (const x of s) c[x.type] = (c[x.type] || 0) + 1;
console.log(s.length, c);
for (const i of [344, 346]) console.log(i, JSON.stringify(s[i]));
// count boxes by material
const m = {};
for (const x of s) { const k = x.type + ':' + (x.mat || ''); m[k] = (m[k] || 0) + 1; }
console.log(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25));
