// Single simulation owner: ShioPuppet. Angles describe restrained ribcage
// rotation about the waist; hips absorb the twist and shoe soles remain pinned.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const ease=t=>{t=clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
const rad=Math.PI/180;
export const TORSO_LIMITS=Object.freeze({yaw:10,pitch:4});
export function turnTrack(age){
 const keys=[[0,0],[2.1,-10],[4.1,-10],[7.1,10],[9.3,10],[12,0]];
 for(let i=1;i<keys.length;i++)if(age<=keys[i][0]){const a=keys[i-1],b=keys[i];return a[1]+(b[1]-a[1])*ease((age-a[0])/(b[0]-a[0]));}
 return 0;
}
export function updateTorsoMotion(host,dt,duration=1){
 const p=host.pose,t=host.time,activity=p.activity??0,g=host.gesture;
 let yaw=p.yaw*.20+Math.sin(t*.31+.4)*.65*activity;
 let pitch=p.pitch*.10+Math.sin(t*.43)*.25*activity;
 if(g){const age=t-g.start,d=duration;
  const e=ease(age/1.6)*(1-ease((age-(d-1.8))/1.8));
  if(g.name==='turnbody'){yaw=turnTrack(age);pitch=Math.sin(age*.6)*1.2*ease(age/1.5)*(1-ease((age-10)/2));}
  else if(g.name==='curtsy')pitch+=3*e;
 }
 const cue=p.bodyCue;if(cue?.orbit){yaw=cue.yaw;pitch=cue.pitch;}else{yaw+=cue?.yaw??0;pitch+=cue?.pitch??0;}
 const target=host.manualTorso??{yaw,pitch};
 p.torsoYaw=clamp(host.spring('torso-yaw',clamp(target.yaw,-10,10),dt,16,12),-10,10);
 p.torsoPitch=clamp(host.spring('torso-pitch',clamp(target.pitch,-4,4),dt,20,13),-4,4);
 p.torsoVelocity=clamp(host.springs['torso-yaw'].velocity,-26,26);
}
// Virtual depth gives the shoulders/chest parallax at small angles.
// A shared affine frame transports each complete arm, including its wrist.
const projectionCache=new WeakMap();
function fullProjection(s){
 let c=projectionCache.get(s);const yaw=s.torsoYaw??0,pitch=s.torsoPitch??0,lean=s.upperLean??0;
 if(!c||c.yaw!==yaw||c.pitch!==pitch||c.lean!==lean){
  c={yaw,pitch,lean,cy:Math.cos(yaw*rad),sy:Math.sin(yaw*rad),cp:Math.cos(pitch*rad),sp:Math.sin(pitch*rad),cl:Math.cos(lean*rad),sl:Math.sin(lean*rad)};
  const x=48*c.sy,y=-350*c.cp-48*c.cy*c.sp;c.head=[x*c.cl-y*c.sl,590+x*c.sl+y*c.cl-240];projectionCache.set(s,c);
 }return c;
}
function rotate(x,y,p,a){const c=Math.cos(a),s=Math.sin(a),dx=x-p[0],dy=y-p[1];return[p[0]+dx*c-dy*s,p[1]+dx*s+dy*c];}
export function projectTorso(x,y,s,weight=1,surfaceDepth=48){
 const yaw=(s.torsoYaw??0)*weight*rad,pitch=(s.torsoPitch??0)*weight*rad,lean=(s.upperLean??0)*weight*rad,hip=(s.hipRoll??0)*(1-weight)*rad;
 if(yaw===0&&pitch===0&&lean===0&&hip===0)return[x,y];
 const dx=x-542,dy=y-590,depth=surfaceDepth*weight,c=weight===1?fullProjection(s):{cy:Math.cos(yaw),sy:Math.sin(yaw),cp:Math.cos(pitch),sp:Math.sin(pitch)};
 const z=depth*c.cy-dx*c.sy;let xx=542+dx*c.cy+depth*c.sy,yy=590+dy*c.cp-z*c.sp;
 if(lean)[xx,yy]=rotate(xx,yy,[542,590],lean);
 if(hip)[xx,yy]=rotate(xx,yy,[542,650],hip);
 return[xx,yy];
}
export function torsoHeadDelta(s){return fullProjection(s).head;}
export function torsoWeight(y){return(1-.72*smooth(475,760,y))*(1-smooth(760,1170,y));}
export function deformTorso(layer,x,y,s,restX=x,restY=y){
 if(!(s.torsoYaw||s.torsoPitch||s.upperLean||s.hipRoll))return[x,y];
 const rigid=layer.kind==='arm-rest',weight=rigid?1:torsoWeight(restY);
 const chest=(1-smooth(35,110,Math.abs(x-542)))*smooth(270,340,y)*(1-smooth(450,545,y));
 const projected=projectTorso(x,y,s,weight,48+(rigid?0:24*chest));
 let headFollow=0;
 if(layer.kind==='hair-lock'||layer.kind==='neck-repair'||layer.kind==='hair')headFollow=1-smooth(235,465,restY);
 else if(layer.name==='body'||layer.name==='neck-front')headFollow=(1-smooth(232,315,restY))*(1-smooth(35,65,Math.abs(restX-542)));
 if(headFollow>0){const d=torsoHeadDelta(s);projected[0]+=(x+d[0]-projected[0])*headFollow;projected[1]+=(y+d[1]-projected[1])*headFollow;}
 return projected;
}
