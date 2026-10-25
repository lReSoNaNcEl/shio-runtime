import {updateCreatureMotion as baseMotion,deformCreature as sideTail} from './creature-base-v22.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),smooth=x=>{const t=clamp(x,0,1);return t*t*t*(10+t*(-15+6*t));};
export function updateCreatureMotion(host,p,dt,duration=3.6){
 const tail=baseMotion(host,p,dt,duration),g=host.gesture,age=g?p.time-g.start:0,u=age/duration;
 const fold=smooth(u/.23)*(1-smooth((u-.62)/.38));p.earCurl??=[0,0];
 for(let side=0;side<2;side++){const active=g?.name===(side?'earRight':'earLeft'),value=host.spring('s21-ear-curl-'+side,active?fold:0,dt,58,13);p.earCurl[side]=clamp(value,0,1);p.earBend[side]=clamp(p.earBend[side]+p.earCurl[side]*18,-12,42);}
 p.tailStyle=host.tailStyle??'side';return tail;
}
// Original tail texture, remapped around a continuous spine behind the torso.
// The same first draw layer gives real body/hair occlusion without a second tail.
const spine=[[675,753,560,676],[780,835,568,558],[946,949,602,446],[1100,859,665,363],[1277,830,710,305]];
function sample(y,column){let i=0;while(i<spine.length-2&&y>spine[i+1][0])i++;const a=spine[i],b=spine[i+1];if(y<spine[0][0])return spine[0][column]+(y-spine[0][0])*(spine[1][column]-spine[0][column])/(spine[1][0]-spine[0][0]);if(y>spine.at(-1)[0])return spine.at(-1)[column]+(y-spine.at(-1)[0])*(spine.at(-1)[column]-spine.at(-2)[column])/(spine.at(-1)[0]-spine.at(-2)[0]);const span=b[0]-a[0],t=clamp((y-a[0])/span,0,1),slope=j=>{const l=spine[Math.max(0,j-1)],r=spine[Math.min(spine.length-1,j+1)];return(r[column]-l[column])/(r[0]-l[0]);},m0=slope(i)*span,m1=slope(i+1)*span,t2=t*t,t3=t2*t;return(2*t3-3*t2+1)*a[column]+(t3-2*t2+t)*m0+(-2*t3+3*t2)*b[column]+(t3-t2)*m1;}
export function behindTail(x,y,p){const center=sample(y,1),base=[sample(y,2),sample(y,3)],a=[sample(y-1,2),sample(y-1,3)],b=[sample(y+1,2),sample(y+1,3)],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.max(.01,Math.hypot(dx,dy)),normal=[-dy/length,dx/length],offset=(x-center)*.44;return[base[0]+normal[0]*offset,base[1]+normal[1]*offset];}
export function deformCreature(layer,x,y,p){if(layer.kind!=='tail')return[x,y];const moved=sideTail(layer,x,y,p);return p.tailStyle==='back'?behindTail(...moved,p):moved;}
