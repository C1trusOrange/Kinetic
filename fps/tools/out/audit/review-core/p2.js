const out=[];
const dirs=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[.707,0,.707],[-.707,0,.707],[.707,0,-.707],[-.707,0,-.707]];
for (let x=-28;x<=28;x+=1) for (let z=-28;z<=28;z+=1){
  let ok=true; let minD=99;
  for (const y of [0.2,1.0,1.8,2.5]) { for (const d of dirs){ const h=game.world.raycast(new THREE.Vector3(x,y,z), new THREE.Vector3(...d), 8); if(h){ok=false;minD=Math.min(minD,h.distance);} } }
  // also floor at y=0 below and no ceiling to 6m
  const f=game.world.raycast(new THREE.Vector3(x,1,z), new THREE.Vector3(0,-1,0), 3);
  const c=game.world.raycast(new THREE.Vector3(x,1,z), new THREE.Vector3(0,1,0), 12);
  if(ok && f && Math.abs(f.point.y)<0.01 && !c) out.push([x,z]);
}
return {n:out.length, first: out.slice(0,20)};
