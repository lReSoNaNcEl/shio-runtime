const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const u=clamp((x-a)/(b-a),0,1);return u*u*u*(10+u*(-15+6*u));};
export function updateBreathing(host,p,dt,duration=1){
 const activity=p.activity??0,cycle=host.time%5.6;
 // Quiet inhale, a short pause and a longer exhale. No volume change below waist.
 let inhale=cycle<1.8?smooth(0,1.8,cycle):1-smooth(2.1,5.6,cycle);
 if(host.gesture?.name==='breathe'){const age=host.time-host.gesture.start;inhale=Math.max(inhale*.25,smooth(.5,2.9,age)*(1-smooth(3.5,8.7,age)));}
 p.breathCycle=host.spring('s13-breath-cycle',inhale*activity,dt,34,13);
 p.breath=(p.breathCycle-.42*activity)*1.7;
}
export function measureKinetics(host,p,dt){
 const k=p.kinetics??={previous:null,velocity:{},acceleration:{}},h=Math.max(dt,1/240);
 const now={x:p.pelvisX??0,y:p.pelvisY??0,yaw:p.torsoYaw??0,pitch:p.torsoPitch??0,headYaw:p.yaw??0,headPitch:p.pitch??0,roll:p.bodyRoll??0,upperLean:p.upperLean??0,hipRoll:p.hipRoll??0};
 if(!k.previous)k.previous={...now};const filter=1-Math.exp(-h*18);
 for(const [name,value]of Object.entries(now)){const oldV=k.velocity[name]??0,v=clamp((value-k.previous[name])/h,-160,160),a=clamp((v-oldV)/h,-240,240);k.acceleration[name]=(k.acceleration[name]??0)+(a-(k.acceleration[name]??0))*filter;k.velocity[name]=v;}
 k.previous=now;
 return k;
}
