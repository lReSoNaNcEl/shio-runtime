const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*t*(10+t*(-15+6*t));};
const envelope=(u,a,b,c,d)=>smooth(a,b,u)*(1-smooth(c,d,u));
export function referenceReaction(name,elapsed,duration){
 const cue={strength:0,smile:0,blush:0,open:0,wink:0,attend:0,sparkle:0,focus:0,relax:0,roll:0,pitch:0,earFold:0,brow:0,tilt:0,gazeY:0,shoulderLift:0};
 if(!Number.isFinite(elapsed)||!Number.isFinite(duration)||duration<=0||elapsed<0||elapsed>=duration)return cue;
 const u=elapsed/duration;
 if(name==='wink'){
  const hold=envelope(u,0,.20,.57,.95);
  cue.strength=hold;cue.smile=.64*hold;cue.blush=.17*hold;cue.attend=.70*hold;
  cue.wink=envelope(u,.08,.25,.42,.68);cue.open=.13*envelope(u,.13,.28,.43,.72);
  cue.sparkle=.25*hold;cue.focus=.4*hold;cue.roll=-1.4*hold;cue.earFold=5*hold;
 }
 return cue;
}
export function mergeReaction(a,b){
 const cue={};for(const key of Object.keys(a))cue[key]=['roll','pitch','brow','tilt','gazeY'].includes(key)?clamp(a[key]+b[key],-4,4):Math.max(a[key],b[key]);return cue;
}
