(function(){
  const g = window.__GAME__, w = g.world;
  const THREE_ = g.camera.position.constructor;
  const sun = w.sun; sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  sun.shadow.updateMatrices(sun);
  const cam = sun.shadow.camera;
  cam.updateMatrixWorld();
  const M = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
  const v = new THREE_();
  let total=0, out=0, outPlay=0, outNear=0, outFar=0, outXY=0;
  const b = w.bounds;
  let worst = 0;
  w._solidsGroup.traverse(o=>{
    if(!o.isMesh || !o.castShadow) return;
    const pos=o.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
      v.fromBufferAttribute(pos,i);
      total++;
      const inPlay = v.x>=b.min.x&&v.x<=b.max.x&&v.y>=b.min.y&&v.y<=b.max.y&&v.z>=b.min.z&&v.z<=b.max.z;
      v.applyMatrix4(M);
      const bad = Math.abs(v.x)>1.0001 || Math.abs(v.y)>1.0001 || v.z<-1.0001 || v.z>1.0001;
      if(bad){ out++; if(inPlay) outPlay++; if (v.z<-1.0001) outNear++; if (v.z>1.0001) outFar++; if(Math.abs(v.x)>1.0001||Math.abs(v.y)>1.0001) outXY++; worst=Math.max(worst,Math.abs(v.x),Math.abs(v.y)); }
    }
  });
  return {map:w.mapId, total, out, outPlay, outNear, outFar, outXY, worst:+worst.toFixed(3),
    cam:{l:cam.left,r:cam.right,t:cam.top,b:cam.bottom,n:cam.near,f:cam.far}, size: sun.shadow.mapSize.x,
    fit: w._shadowFit, bias: sun.shadow.bias, nb: sun.shadow.normalBias, sunPos: sun.position.toArray(), sunDir: w.lighting.sunDirection.toArray(),
    bounds:[b.min.toArray(), b.max.toArray()], castShadow: sun.castShadow, q: g.quality.name};
})()
