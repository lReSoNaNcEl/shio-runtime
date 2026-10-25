import {ARM_POSES,armReaction,updateArmMotion as updateHeldMotion} from '../v18/arm-poses-v18.mjs';
export {ARM_POSES,armReaction};
const rad=Math.PI/180,deg=180/Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const ARM_KEYS=Object.freeze({
 waist:[{S:[422,333],E:[418,438],W:[500,480],hand:30},{S:[660,333],E:[664,438],W:[586,480],hand:145}],
 heart:[{S:[422,333],E:[413,460],W:[487,338],hand:-25},{S:[660,333],E:[677,460],W:[526,401],hand:198}],
 thoughtful:[{S:[422,333],E:[415,457],W:[477,299],hand:-49},{S:[660,333],E:[678,457],W:[477,447],hand:180}]
});
function channels(name){return ARM_KEYS[name].flatMap((a,side)=>{let f=Math.atan2(a.W[1]-a.E[1],a.W[0]-a.E[0])*deg;if(side&&f<0)f+=360;return[Math.atan2(a.E[1]-a.S[1],a.E[0]-a.S[0])*deg,Math.hypot(a.E[0]-a.S[0],a.E[1]-a.S[1]),f,Math.hypot(a.W[0]-a.E[0],a.W[1]-a.E[1]),a.hand-f];});}
export function quintic(p,v,a,target,T){const V=v*T,A=a*T*T,D=target-p-V-A/2,dV=-V-A,dA=-A;return[p,V,A/2,10*D-4*dV+dA/2,-15*D+7*dV-dA,6*D-3*dV+dA/2];}
export function sampleTrack(c,u,T){const p=c[0]+u*(c[1]+u*(c[2]+u*(c[3]+u*(c[4]+u*c[5])))),v=(c[1]+u*(2*c[2]+u*(3*c[3]+u*(4*c[4]+u*5*c[5]))))/T,a=(2*c[2]+u*(6*c[3]+u*(12*c[4]+u*20*c[5])))/(T*T);return[p,v,a];}
export function updateArmMotion(host,pose,dt){
 updateHeldMotion(host,pose,dt);
 let r=host.armTrajectory;
 if(!r){const c=channels(host.armPose);r=host.armTrajectory={target:host.armPose,from:host.armPose,value:c,velocity:c.map(()=>0),acceleration:c.map(()=>0),age:0,duration:0,curves:null,shapeStart:Object.keys(ARM_KEYS).map(n=>n===host.armPose?1:0),times:null,weights:Object.keys(ARM_KEYS).map(n=>n===host.armPose?1:0)};}
 if(r.target!==host.armPose){
  const target=channels(host.armPose),rotation=Math.max(...target.map((v,i)=>i%5===0||i%5===2||i%5===4?Math.abs(v-r.value[i]):0));
  const T=clamp(1.25+rotation/90,1.65,2.6);r.from=r.target;r.target=host.armPose;r.age=0;r.shapeStart=r.weights.slice();
  r.times=target.map((_,i)=>T*(i<5?(i%5<2?.90:.96):(i%5<2?.94:1.04)));r.duration=Math.max(...r.times);
  r.curves=target.map((v,i)=>quintic(r.value[i],r.velocity[i],r.acceleration[i],v,r.times[i]));
 }
 if(r.curves){r.age=Math.min(r.duration,r.age+dt);for(let i=0;i<r.value.length;i++){const T=r.times[i],[p,v,a]=sampleTrack(r.curves[i],clamp(r.age/T,0,1),T);r.value[i]=p;r.velocity[i]=r.age>=T?0:v;r.acceleration[i]=r.age>=T?0:a;}if(r.age===r.duration){r.value=channels(r.target);r.velocity.fill(0);r.acceleration.fill(0);r.curves=null;}}
 const names=Object.keys(ARM_KEYS),phase=r.curves?clamp((r.age/r.duration-.14)/.66,0,1):1,shape=phase*phase*phase*(10+phase*(-15+6*phase));
 for(let i=0;i<3;i++){const target=names[i]===r.target?1:0,desired=r.shapeStart[i]+(target-r.shapeStart[i])*shape;if(!host.springs['arm-shape-'+i])host.springs['arm-shape-'+i]={value:r.weights[i],velocity:0};r.weights[i]=clamp(host.spring('arm-shape-'+i,desired,dt,72,18),0,1);}
 let sum=r.weights.reduce((a,b)=>a+b,0);if(sum<1e-8){r.weights=names.map(n=>n===r.target?1:0);sum=1;}r.weights=r.weights.map(x=>x/sum);
 const shapeMoving=r.weights.some((w,i)=>Math.abs(w-(names[i]===r.target?1:0))>.006);

 const m=pose.armMotion;
 pose.armRig={limbs:[0,1].map(side=>{const [upper,length,fore,foreLength,wrist]=r.value.slice(side*5,side*5+5),S=[side?660:422,333],E=[S[0]+Math.cos(upper*rad)*length+m.x*.25,S[1]+Math.sin(upper*rad)*length+m.y*.25],W=[E[0]+Math.cos(fore*rad)*foreLength+m.x*.75,E[1]+Math.sin(fore*rad)*foreLength+m.y*.75];const drag=clamp(host.spring('arm-wrist-drag-'+side,clamp(-r.velocity[side*5+2]*.018,-1.2,1.2),dt,125,22),-1.2,1.2),fingerFlex=host.spring('arm-finger-flex-'+side,(Math.sin(host.time*.91+side*.8)*.14*(pose.activity??0)+clamp(-r.acceleration[side*5+2]*.0008,-.18,.18)),dt,70,17);const sleeve={swing:host.spring('s21-sleeve-swing-'+side,clamp(-r.velocity[side*5]*.028-r.acceleration[side*5+2]*.005,-2.1,2.1)+(Math.sin(host.time*1.13+side*.9)*.55+(pose.wind??0)*1.2)*(pose.activity??0),dt,54,10.5),billow:host.spring('s21-sleeve-billow-'+side,(pose.breathCycle??0)*.55+Math.sin(host.time*.97+side)*.20*(pose.activity??0),dt,46,12),flutter:host.spring('s21-sleeve-flutter-'+side,Math.sin(host.time*1.9+side*1.2)*.35*(pose.activity??0)+(pose.wind??0)*.7,dt,68,11.5)};return{S,E,W,hand:fore+wrist+drag,fingerFlex,sleeve,cuffAngle:fore+clamp(wrist*.10+drag*.5,-3.2,3.2)};}),weights:r.weights.slice()};
 pose.armTransition={from:r.from,target:r.target,moving:!!r.curves||shapeMoving,progress:r.curves?r.age/r.duration:1,duration:r.duration};
}
