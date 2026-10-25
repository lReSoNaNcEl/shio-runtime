import {makeChain,stepChain,sampleChain} from '../v16/xpbd-chains-v13.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export function updateTextiles(host,p,dt){
 const k=p.kinetics??{acceleration:{},velocity:{}},a=k.acceleration,v=k.velocity,t=p.textiles??={hair:[],cloth:[],strands:[]};t.strands??=[];
 for(let side=0;side<2;side++){t.cloth[side]??=makeChain(Array.from({length:8},(_,i)=>[0,i*110]),'velvet');stepChain(t.cloth[side],dt,[-(a.x??0)*1.2-(a.yaw??0)*.55-(v.yaw??0)*.28-(a.hipRoll??0)*5.5-(a.upperLean??0)*1.7,-(a.y??0)*.8],(p.wind??0)*(44+side*3));}
 return t;
}
export function hairDisplacement(layer,y,p,x=layer.x+layer.width*.5){
 const f=clamp((y-layer.pivot[1])/layer.length,0,1),d=sampleChain(p.textiles?.hair?.[layer.chain],f),lane=clamp((x-layer.x)/layer.width*3,0,3),i=Math.min(2,Math.floor(lane)),u=lane-i;
 const a=sampleChain(p.textiles?.strands?.[layer.chain]?.[i],f),b=sampleChain(p.textiles?.strands?.[layer.chain]?.[i+1],f),phase=layer.chain*.9+lane*1.8;
 const free=smooth(220,560,y),curl=Math.sin(p.time*1.7-y*.018+phase)*(p.wind??0)*2.3*free;
 return[clamp(d[0]+(a[0]*(1-u)+b[0]*u)*free+curl,-35,35),clamp(d[1]+(a[1]*(1-u)+b[1]*u)*free,-8,8)];
}
export function panelDelta(x,y,layer,p){const f=clamp((y-layer.pivot[1])/770,0,1),d=sampleChain(p.textiles?.cloth?.[layer.side<0?0:1],f),pin=smooth(layer.pivot[1],layer.pivot[1]+100,y),column=clamp((x-layer.pivot[0])/310,-1,1),fan=1+column*layer.side*.12;return[clamp(d[0]*pin*fan,-20,20),clamp(d[1]*pin,-8,8)];}
export function deformPanel(x,y,layer,p){const d=panelDelta(x,y,layer,p);return[x+d[0],y+d[1]];}