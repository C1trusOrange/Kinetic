(() => {
  const g = window.__GAME__, nav = g.world.nav;
  const V = nav.nodes[0].position.constructor;
  const from = new V(-12.5, 5, -4.4), to = new V(-3.5, 9.5, -20.5);
  const s = nav.nearestNode(from, 8), e = nav.nearestNode(to, 8);
  const p = nav.findPath(from, to);
  const f = v => +v.toFixed(2);
  // reconstruct chain via internal parent pointers (findPath just ran)
  const chain = []; for (let n = e.id; n !== -1; n = nav._parent[n]) chain.push(n); chain.reverse();
  const nodes = chain.map((id, i) => { const nd = nav.nodes[id]; const prev = i ? nav._linkBetween(chain[i-1], id) : null; return [f(nd.position.x), f(nd.position.y), f(nd.position.z), prev ? prev.type + (prev.pad ? '*' : '') : 'start'].join(','); });
  return { start: [s.position.x, s.position.y, s.position.z].map(f), chain: nodes, path: p.map(w => [f(w.x), f(w.y), f(w.z), w.type].join(',')) };
})()
