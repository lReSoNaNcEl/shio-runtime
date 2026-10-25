const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ease=x=>{const t=clamp(x,0,1);return t*t*t*(10+t*(-15+6*t));};
export const ORBIT_DURATION=11.6;
export function bodyMotionCue(time,gesture,activity=1){
 const idle={x:0,y:0,yaw:Math.sin(time*.48-.3)*.55*activity,pitch:0,upperLean:-Math.sin(time*.48+.13)*.36*activity,hipRoll:Math.sin(time*.48+.6)*.24*activity,headYaw:0,headPitch:0,headRoll:0,orbit:0};
 if(gesture?.name!=='orbit')return idle;
 const age=time-gesture.start;if(age<0||age>=ORBIT_DURATION)return idle;
 const progress=ease((age-.65)/9.5),theta=progress*Math.PI*2,envelope=ease((age-.15)/.9)*(1-ease((age-9.7)/1.9));
 return{x:Math.sin(theta)*18,y:(1-Math.cos(theta))*13.5,yaw:Math.sin(theta)*9.3,pitch:(1-Math.cos(theta))*1.8,upperLean:-Math.sin(theta-.16)*1.5*envelope,hipRoll:Math.sin(theta+.32)*.90*envelope,headYaw:Math.sin(theta-.25)*6*envelope,headPitch:-Math.sin(theta-.45)*2*envelope,headRoll:-Math.sin(theta)*2.1*envelope,orbit:1};
}
export function updateBodyCoordination(host,p,dt,cue){
 p.upperLean=host.spring('s14-upper-lean',cue.upperLean,dt,40,14);
 p.hipRoll=host.spring('s14-hip-roll',cue.hipRoll,dt,36,13);
 p.bodyCue=cue;
}
