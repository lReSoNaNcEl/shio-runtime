const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// A bounded guide removes instant acceleration on mouse jumps. The approved
// angle meshes and artwork remain the sole source of facial shape.
export function updateHeadMotion(host,p,targets,dt){
 const limits=host.headLimits();for(const [axis,speed,accel,k,d] of [['yaw',100,420,90,19],['pitch',65,260,90,19],['roll',60,240,80,18]]){
  const limit=limits[axis+'Limit'],goal=clamp(targets[axis],-limit,limit),guide=host.springs['headGuide'+axis]??={value:host.springs[axis]?.value??p[axis]??0,velocity:host.springs[axis]?.velocity??0},distance=goal-guide.value;
  const velocity=Math.sign(distance)*Math.min(speed,Math.sqrt(2*accel*Math.abs(distance)));guide.velocity+=clamp(velocity-guide.velocity,-accel*dt,accel*dt);const delta=guide.velocity*dt;
  if(Math.abs(delta)>=Math.abs(distance)&&Math.sign(delta)===Math.sign(distance)){guide.value=goal;guide.velocity=0;}else guide.value=clamp(guide.value+delta,-limit,limit);
  p[axis]=clamp(host.spring(axis,guide.value,dt,k,d),-limit,limit);
 }
}
