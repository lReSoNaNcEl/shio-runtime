import {bodyMotionCue as baseCue,updateBodyCoordination,ORBIT_DURATION} from '../v16/body-coordination-v16.mjs';
export {updateBodyCoordination,ORBIT_DURATION};
export const LEG_FLOW_DURATION=10.8;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),ease=x=>{const t=clamp(x,0,1);return t*t*t*(10+t*(-15+6*t));};
export function bodyMotionCue(time,gesture,activity=1){
 const legs=gesture?.name==='legflow',age=gesture?time-gesture.start:-1,scaledAge=legs?age*ORBIT_DURATION/LEG_FLOW_DURATION:age;
 const proxy=legs?{name:'orbit',start:time-scaledAge}:gesture,cue=baseCue(time,proxy,activity);
 if(!cue.orbit)return cue;
 const phase=ease((scaledAge-.65)/9.5)*Math.PI*2,weight=ease((scaledAge-.15)/.9)*(1-ease((scaledAge-9.7)/1.9));
 cue.x*=legs?.38:.45;cue.y*=legs?.20:.24;cue.yaw*=legs?.55:.70;cue.pitch*=.70;cue.upperLean*=.65;cue.hipRoll*=.55;if(legs){cue.headYaw*=.65;cue.headPitch*=.65;cue.headRoll*=.65;}
 return{...cue,legFlow:{phase,weight,reference:'PSD2Live star-orbit'}};
}
export function applyLegFlow(cue,feet){
 if(!cue.legFlow)return;const {phase:t,weight:w}=cue.legFlow;
 // The hip circle and asymmetric knee arcs exchange support; the feet do
 // not translate or lift. Small shoe rolls pivot on the existing sole.
 feet[0].knee+=(-4.5*Math.sin(t-.12)+.7*Math.sin(2*t))*w;
 feet[1].knee+=(-6*Math.sin(t+.10)-.6*Math.sin(2*t))*w;
 feet[0].roll+=Math.sin(t-.12)*.30*w;feet[1].roll+=Math.sin(t+.10)*.30*w;
}
