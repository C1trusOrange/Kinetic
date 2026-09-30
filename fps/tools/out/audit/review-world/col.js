(function(){
  const g = window.__GAME__, w = g.world, c = w.collision;
  const V = (x,y,z)=>new g.camera.position.constructor(x,y,z);
  const down = V(0,-1,0);
  function col(x, z, y0=60){
    const out=[]; let y=y0; let guard=0;
    while(guard++<20){
      const h = c.raycast(V(x,y,z), down, 200);
      if(!h) break;
      out.push([+h.point.y.toFixed(2), +h.normal.y.toFixed(2), h.surface]);
      y = h.point.y - 0.001;
    }
    return out;
  }
  const pts = window.__PTS__;
  const res = {};
  for (const [k,x,z] of pts) res[k]=col(x,z);
  return JSON.stringify(res);
})()
