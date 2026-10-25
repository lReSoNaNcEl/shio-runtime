const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const u=clamp((v-a)/(b-a),0,1);return u*u*u*(10+u*(-15+6*u));};
const rad=v=>v*Math.PI/180;
const rotate=(x,y,p,a)=>{const c=Math.cos(a),s=Math.sin(a),dx=x-p[0],dy=y-p[1];return[p[0]+dx*c-dy*s,p[1]+dx*s+dy*c];};
const env=(u,a,b,c,d)=>smooth(a,b,u)*(1-smooth(c,d,u));
export function updateCreatureMotion(host,p,dt,gestureDuration=2.7){
 const t=p.time??0,w=host.weights??{},activity=p.activity??0;
 const happy=(w.happy??0)+(w.excited??0)*.8,shy=w.shy??0,sad=(w.sad??0)+(w.crying??0),love=w.loving??0,worry=w.worried??0;
 const g=host.gesture,age=g?t-g.start:0,duration=gestureDuration,u=age/duration;
 p.earBend??=[0,0];p.earSpread??=[0,0];
 for(let side=0;side<2;side++){
  const sign=side?1:-1,asym=side?.77:1;

  const tip=shy*23+sad*31+love*18+worry*(side?9:27)-happy*6+(w.sleepy??0)*25;
  const earInertia=clamp(-(p.kinetics?.velocity.headPitch??0)*.026-(p.kinetics?.acceleration.headPitch??0)*.006,-3,3);
  const actingFold=earInertia+(p.reactionCue?.earFold??0)*(side?.70:1);
  const earFlick=g?.name==='ears'?env(u,side?.27:.10,side?.43:.26,side?.55:.39,side?.84:.68):0;
  const twitch=earFlick*(side?22:25)+Math.exp(-(((t%11.7-2.6-side*.1)/.16)**2))*6*activity;
  p.earBend[side]=clamp(host.spring('v8-ear-tip-'+side,tip*activity*asym+actingFold*asym+twitch,dt,70,12),-12,42);
  p.earSpread[side]=clamp(host.spring('v8-ear-spread-'+side,sign*((w.angry??0)*9-sad*7+happy*2+Math.sin(t*.67+side)*1.7)*activity-(p.kinetics?.velocity.headYaw??0)*.018,dt,60,12),-12,12);
 }
 const speed=clamp(host.springs.pelvisX?.velocity??0,-45,45),vertical=clamp(host.springs.pelvisY?.velocity??0,-40,40);
 const swish=g?.name==='tail'?env(age/3.8,0,.15,.7,1):0,curl=g?.name==='tailcurl'?env(u,0,.25,.67,1):0;
 const tail=p.tailMotion??={nodes:[0,0,0,0],fluff:0};
 for(let i=0;i<4;i++){const lead=i?tail.nodes[i-1]*.62:-speed*.055,idle=(Math.sin(t*(.74+happy*.22)-i*.64)*(1.9+happy*2.4)+Math.sin(t*1.31-i*.85)*.55)*activity,flick=swish*Math.sin(age*(2.3+i*.04)-i*.55)*(2.3+i*.75),coiling=curl*(i+1)*4.5;tail.nodes[i]=clamp(host.spring('tail-node-'+i,lead+idle+flick+coiling-vertical*.013*(i+1)-(p.kinetics?.acceleration.x??0)*.006*(i+1)-(p.kinetics?.velocity.yaw??0)*.045,dt,36-i*4,8.7-i*.8),-16,25);}
 tail.fluff=clamp(host.spring('v8-tail-fluff',((w.surprised??0)*.025+(w.excited??0)*.012)*activity,dt,35,9),0,.03);

 return tail;
}
const joints=[[835,780],[949,946],[859,1100],[864,1190]];
function ordinaryTail(x,y,p){
 const root=[753,675],restY=y,m=p.tailMotion;
 const rootAngle=rad(clamp(p.tail??0,-18,18)*.48);[x,y]=rotate(x,y,root,rootAngle);
 const centers=[];
 for(let i=0;i<joints.length;i++){
  let [px,py]=rotate(...joints[i],root,rootAngle);
  for(let j=0;j<i;j++)[px,py]=rotate(px,py,centers[j],rad((m?.nodes?.[j]??0)*smooth(joints[j][1]-55,joints[j][1]+145,joints[i][1])));
  centers.push([px,py]);
  const angle=rad((m?.nodes?.[i]??0)*smooth(joints[i][1]-55,joints[i][1]+145,restY));
  [x,y]=rotate(x,y,centers[i],angle);
 }
 const f=smooth(675,970,restY)*(1-smooth(1190,1300,restY));
 x+=(x-root[0])*(m?.fluff??0)*f;
 return[x,y];
}
export function deformCreature(layer,x,y,p){return layer.kind==='tail'?ordinaryTail(x,y,p):[x,y];}
