import {panelDelta} from '../v16/textiles-v16.mjs';
import {legDelta} from './leg-rig-v22.mjs';
import {GARMENT_RIG,deformGarment} from '../v16/garment-motion-v16.mjs';
// Secondary motion in source-art world units. The puppet remains the sole
// simulation owner. This module allocates no timers, listeners or GPU resources.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=(x,f=0)=>Number.isFinite(x)?x:f;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const kernel=q=>{const x=clamp(q,0,1);return (1-x*x)**3;};
const rotate=(x,y,p,a)=>{const c=Math.cos(a),s=Math.sin(a),dx=x-p[0],dy=y-p[1];return[p[0]+c*dx-s*dy,p[1]+s*dx+c*dy];};

export const SECONDARY_RIG=Object.freeze({
  ribcage:{center:[542,356],width:128,vertical:[244,323,410,500],maximumExpansion:2.0,maximumLift:1.7},
  bust:[
    {center:[491,365],radius:[66,67],underbust:[493,421]},
    {center:[584,365],radius:[66,67],underbust:[581,421]},
  ],
  shoulders:[[416,347],[669,347]],
  garters:[
    {side:-1,body:'body',cloth:'skirt-left',leg:'leg-left',top:[469,660],clip:[475,704],bottom:[477,733],width:25},
    {side:1,body:'body',cloth:'skirt-right',leg:'leg-right',top:[603,631],clip:[599,704],bottom:[595,731],width:25},
  ],
});
function limitedSpring(host,key,target,dt,k,d,bound){
 const value=host.spring(key,clamp(target,-bound,bound),dt,k,d),bounded=clamp(finite(value),-bound,bound);
 const state=host.springs?.[key];
 if(state&&value!==bounded){state.value=bounded;if(Math.sign(state.velocity)===Math.sign(value))state.velocity=0;}
 return bounded;
}
function clothDelta(point,layer,pose){return layer?panelDelta(...point,layer,pose):[0,0];}
function garmentClothDelta(point,layer,pose){
 if(!layer)return[0,0];
 const a=deformGarment(layer,...point,pose,{garmentRig:pose.secondary?.garmentRig??GARMENT_RIG});
 const d=clothDelta(a,layer,pose);return[a[0]+d[0]-point[0],a[1]+d[1]-point[1]];
}
function breathDelta(x,y,s){
 const r=SECONDARY_RIG.ribcage,w=smooth(r.vertical[0],r.vertical[1],y)*(1-smooth(r.vertical[2],r.vertical[3],y));
 const out=[(x-r.center[0])/r.width*s.expansion*w,-s.lift*w];
 for(let side=0;side<2;side++){const q=Math.hypot((x-SECONDARY_RIG.shoulders[side][0])/46,(y-347)/43),weight=kernel(q);out[0]+=(s.clavicles?.[side]?.[0]??0)*weight;out[1]+=(s.clavicles?.[side]?.[1]??0)*weight;}return out;
}
export function updateSecondaryMotion(host,pose,dt){
 const h=clamp(finite(dt),0,.05),t=finite(pose.time),activity=clamp(finite(pose.activity),0,1.5);
 const s=pose.secondary??={bust:[[0,0],[0,0]],shoulders:[[0,0],[0,0]],garters:[],previousVX:0,previousVY:0};
 s.thighs??=[[0,0],[0,0]];s.clavicles??=[[0,0],[0,0]];
 const motion=pose.kinetics??{acceleration:{},velocity:{}},yawA=motion.acceleration.yaw??0,yawV=motion.velocity.yaw??0;
 const vx=clamp(finite(host.springs?.pelvisX?.velocity),-60,60),vy=clamp(finite(host.springs?.pelvisY?.velocity),-60,60);
 const ax=h?clamp((vx-s.previousVX)/Math.max(h,.008),-170,170):0,ay=h?clamp((vy-s.previousVY)/Math.max(h,.008),-170,170):0;
 s.previousVX=vx;s.previousVY=vy;s.garmentRig=host.model?.physics?.garmentRig??GARMENT_RIG;
 const phase=t*1.26+Math.sin(t*.19)*.045;
 const inhale=(.5-.5*Math.cos(phase))*.94+(.5-.5*Math.cos(phase*2))*.06;
 s.inhale=clamp(limitedSpring(host,'secondary-inhale',(pose.breathCycle??inhale*activity),h,36,12,1.5),0,1.5);
 s.expansion=s.inhale*SECONDARY_RIG.ribcage.maximumExpansion;
 s.lift=s.inhale*SECONDARY_RIG.ribcage.maximumLift;
 const roll=clamp(finite(host.springs?.bodyRoll?.velocity),-35,35);
 const breathSpeed=finite(host.springs?.['s13-breath-cycle']?.velocity),sway=limitedSpring(host,'s21-bust-common-x',-ax*.028-vx*.012-yawA*.020-yawV*.035,h,70,10.8,2.8),heave=limitedSpring(host,'s21-bust-common-y',-ay*.045-vy*.028-(motion.acceleration.pitch??0)*.045-breathSpeed*1.2-s.inhale*1.2,h,58,10.4,4.4),rock=limitedSpring(host,'s21-bust-rock',-roll*.045-yawA*.003,h,82,12.5,.8);s.bustDynamics={sway,heave,rock};
 for(let i=0;i<2;i++){
  const side=i?1:-1;
  // Covered bodice masses have small independent inertia. Underbust and
  // neckline are pinned by the spatial field, so the corset never detaches.
  s.clavicles[i][0]=limitedSpring(host,'s13-clavicle-x'+i,-yawV*.010,h,75,16,.65);
  s.clavicles[i][1]=limitedSpring(host,'s13-clavicle-y'+i,-ay*.0015,h,70,15,.65);
  s.thighs[i][0]=limitedSpring(host,'s13-thigh-x'+i,-ax*.010-yawA*.004,h,69+i*5,13,1.25);
  s.thighs[i][1]=limitedSpring(host,'s13-thigh-y'+i,-ay*.014,h,75+i*4,14,1.8);
  s.bust[i][0]=limitedSpring(host,'secondary-bust-x'+i,sway+side*s.inhale*.22+side*rock*.22,h,94+i*3,13.5,3.0);
  s.bust[i][1]=limitedSpring(host,'secondary-bust-y'+i,heave+side*rock*.65,h,88+i*4,12.8,4.5);
  s.shoulders[i]=breathDelta(...SECONDARY_RIG.shoulders[i],s);
 }
 const layers=host.model?.layers??[];
 s.garters=SECONDARY_RIG.garters.map((rig,i)=>{
  const old=s.garters[i]??{},cloth=layers.find(l=>l.name===rig.cloth),leg=layers.find(l=>l.name===rig.leg);
  const flutterX=limitedSpring(host,'secondary-garter-x'+i,-ax*.002+finite(pose.wind)*.42+Math.sin(t*1.1+i*.9)*.45*activity,h,75+i*4,12,1.4);
  const flutterY=limitedSpring(host,'secondary-garter-y'+i,-ay*.002+Math.sin(t*1.26+i*.4)*.28*activity,h,84+i*3,13,.8);
  // The upper endpoint belongs to the moving hem, the bottom to the stocking.
  const top=garmentClothDelta(rig.top,cloth,pose);top[0]+=flutterX;top[1]+=flutterY;
  const bottom=legDelta(rig.bottom,leg,pose);
  const flex=limitedSpring(host,'secondary-garter-flex'+i,-vx*.009+Math.sin(t*1.52+i)*.32*activity,h,90+i*7,10,.85);
  return{...old,top,bottom,flex,cloth,leg};
 });
 return s;
}
/**
 * Invoke AFTER local garment/arm/cloth/leg transforms, BEFORE the common root.
 * No head, face, hair, tail or neckline presentation layer is modified.
 */
export function deformSecondary(layer,x,y,pose){
 const s=pose.secondary;if(!s)return[x,y];
 const originalX=x,originalY=y;
 const body=layer.kind==='body'&&['body','torso-bridge'].includes(layer.name);
 if(body){
  const d=breathDelta(x,y,s);x+=d[0];y+=d[1];
  if(layer.name==='body'&&originalY>300&&originalY<421){
   let dx=0,dy=0;
   for(let i=0;i<2;i++){
    const r=SECONDARY_RIG.bust[i],q=Math.hypot((originalX-r.center[0])/r.radius[0],(originalY-r.center[1])/r.radius[1]);
    const pin=smooth(300,326,originalY)*(1-smooth(397,421,originalY)),w=kernel(q)*pin;
    dx+=s.bust[i][0]*w;dy+=s.bust[i][1]*w;
   }
   x+=dx;y+=dy;
  }
 }else if(['arm-rest'].includes(layer.kind)){
  // Translating the entire arm hierarchy by the same shoulder displacement
  // preserves its existing joint lengths and wrist connection.
  const d=s.shoulders[layer.side<0?0:1];if(d){x+=d[0];y+=d[1];}
 }
 if(!['body','cloth','leg'].includes(layer.kind)||layer.name==='torso-bridge')return[x,y];
 if(originalY<600||originalY>766||originalX<430||originalX>644)return[x,y];
 for(let i=0;i<SECONDARY_RIG.garters.length;i++){
  const rig=SECONDARY_RIG.garters[i],g=s.garters[i];
  if(!g||![rig.body,rig.cloth,rig.leg].includes(layer.name))continue;
  if(originalY<rig.top[1]-28||originalY>rig.bottom[1]+28||originalX<Math.min(rig.top[0],rig.bottom[0])-rig.width-10||originalX>Math.max(rig.top[0],rig.bottom[0])+rig.width+10)continue;
  const start=rig.top,end=rig.bottom,dy=end[1]-start[1];
  // Invert the tiny owning cloth/leg displacement to evaluate one shared rest
  // field on overlapping painted pieces. Four fixed-point steps keep the shared endpoints subpixel exact.
  let rest=[originalX,originalY];
  for(let j=0;j<4;j++){
   const d=layer.kind==='cloth'?garmentClothDelta(rest,g.cloth,pose):layer.kind==='leg'?legDelta(rest,g.leg,pose):[0,0];
   rest=[originalX-d[0],originalY-d[1]];
  }
  const f=clamp((rest[1]-start[1])/dy,0,1),cx=start[0]+(end[0]-start[0])*f;
  const cap=rest[1]<start[1]?start[1]-rest[1]:rest[1]>end[1]?rest[1]-end[1]:0;
  const q=Math.hypot((rest[0]-cx)/rig.width,cap/20);if(q>=1)continue;
  const w=kernel(q);
  const owner=layer.kind==='cloth'?garmentClothDelta(rest,g.cloth,pose):layer.kind==='leg'?legDelta(rest,g.leg,pose):[0,0];
  const target=[g.top[0]*(1-f)+g.bottom[0]*f+g.flex*Math.sin(Math.PI*f),g.top[1]*(1-f)+g.bottom[1]*f];
  x+=(target[0]-owner[0])*w;y+=(target[1]-owner[1])*w;
 }
 return[x,y];
}
export const secondaryOwnerTransforms=Object.freeze({clothDelta,garmentClothDelta,legDelta,breathDelta});





