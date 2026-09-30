const h = game.world.raycast(new THREE.Vector3(10,1,11), new THREE.Vector3(0,0,-1), 50);
return h ? {d:h.distance,p:h.point.toArray(),n:h.normal.toArray(),tri:[h.triangle.a.toArray(),h.triangle.b.toArray(),h.triangle.c.toArray()],s:h.surface} : null;
