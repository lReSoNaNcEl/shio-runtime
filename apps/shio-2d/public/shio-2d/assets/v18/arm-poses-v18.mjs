// Approved concepts 1 / 3 / 4. Each painting contains both continuous arms.
// One field moves both sides of every hand/forearm contact. Sleeve roots stay
// pinned to their shoulders; no independent elbow or wrist segments exist.
export const ARM_POSES=Object.freeze({waist:'Ладони у пояса',heart:'Ладонь у сердца',thoughtful:'Задумчивость'});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export function armReaction(host,blank,dt){
 const a=host.spring('arm-acting',host.motion?host.liveliness:0,dt,30,13),name=host.armPose;
 const profiles={waist:{strength:.08,smile:.12,earFold:1.2},heart:{strength:.28,smile:.36,blush:.07,roll:-1.6,pitch:1.1,earFold:4.5,relax:.13,attend:.08},thoughtful:{strength:.19,smile:.18,brow:.08,tilt:-.12,roll:1.5,pitch:-.7,earFold:6,relax:.08,gazeY:.025}};
 // Smooth acting separately from the explicit held-pose choice. The existing
 // face mixer remains the only facial writer and all art/geometry is S17.
 const cue={...blank},profile=profiles[name]??profiles.waist;
 for(const key of Object.keys(blank))cue[key]=host.spring('arm-cue-'+key,(profile[key]??0)*a,dt,34,14);
 return cue;
}
export function updateArmMotion(host,pose,dt){
 const t=host.time,a=pose.activity??0,breath=pose.secondary?.inhale??0;
 const name=host.armPose;
 pose.armPose=name;
 const profile=name==='thoughtful'?[.42,.75]:name==='heart'?[.65,1.25]:[.75,1.45];
 pose.armMotion={x:host.spring('arm-contact-x',Math.sin(t*.63+.7)*profile[0]*a,dt,32,13),y:host.spring('arm-contact-y',(-breath*.50+Math.sin(t*.84)*.30*a)*profile[1],dt,38,14),fingers:host.spring('arm-fingers',Math.sin(t*.71+.5)*.20*a,dt,40,14)};
}
export function deformArmPose(layer,x,y,pose){
 if(layer.armPose==='waist')x=542+(x-542)*(1-.13*smooth(350,440,y));
 const roots=[[422,333],[660,333]],d0=Math.hypot(x-roots[0][0],y-roots[0][1]),d1=Math.hypot(x-roots[1][0],y-roots[1][1]);
 const free=smooth(18,112,Math.min(d0,d1)),m=pose.armMotion??{x:0,y:0,fingers:0};
 x+=m.x*free;y+=m.y*free;
 // A single displacement over both touching hands preserves the support.
 // Fingertip flex stays below 0.21 source-world units and fades through palm.
 const center=layer.armPose==='waist'?[542,510]:layer.armPose==='heart'?[531,295]:[522,253];
 const hand=1-smooth(20,62,Math.hypot(x-center[0],y-center[1]));
 y+=m.fingers*hand*free;
 const shoulders=pose.secondary?.shoulders;
 if(shoulders){const w=smooth(465,615,x);x+=shoulders[0][0]*(1-w)+shoulders[1][0]*w;y+=shoulders[0][1]*(1-w)+shoulders[1][1]*w;}
 return[x,y];
}
