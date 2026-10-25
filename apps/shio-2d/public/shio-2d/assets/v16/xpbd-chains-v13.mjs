// Independent, small XPBD chains. The puppet owns time and all state.
// This is our implementation of standard distance constraints, not PSD2Live code.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const MATERIALS=Object.freeze({
 hair:{damping:4.1,shape:19,compliance:1e-8,iterations:7},
 bangs:{damping:9,shape:70,compliance:2e-9,iterations:7},
 velvet:{damping:5.8,shape:16,compliance:2e-9,iterations:8},
 silk:{damping:3.8,shape:42,compliance:2e-9,iterations:8},
 elastic:{damping:8,shape:90,compliance:1e-9,iterations:7},
});
export function makeChain(rest,material='hair'){
 const points=rest.map(p=>p.slice());
 return{rest:points.map(p=>p.slice()),points,velocity:points.map(()=>[0,0]),lengths:points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1])),material:MATERIALS[material]??MATERIALS.hair,maxStretch:1,peak:0};
}
export function stepChain(chain,dt,force=[0,0],wind=0){
 if(!(dt>0))return chain;const m=chain.material,h=Math.min(dt,1/120),p=chain.points,v=chain.velocity,r=chain.rest,before=p.map(a=>a.slice());
 for(let i=1;i<p.length;i++){
  const free=i/(p.length-1),rootEase=free*free*(3-2*free),mass=1+free*.35;
  for(let axis=0;axis<2;axis++){const external=clamp(force[axis]+(axis===0?wind*(.2+.8*free):0),-260,260)*rootEase/mass;
   v[i][axis]=(v[i][axis]+(external-(p[i][axis]-r[i][axis])*m.shape)*h)*Math.exp(-m.damping*h);
   p[i][axis]+=v[i][axis]*h;}
 }
 p[0][0]=r[0][0];p[0][1]=r[0][1];
 const lambda=new Float64Array(chain.lengths.length),alpha=m.compliance/(h*h);
 for(let iteration=0;iteration<m.iterations;iteration++)for(let j=0;j<chain.lengths.length;j++){
  const a=p[j],b=p[j+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<1e-9)continue;
  const wa=j===0?0:1,wb=1,delta=(-(length-chain.lengths[j])-alpha*lambda[j])/(wa+wb+alpha);lambda[j]+=delta;
  const x=dx/length*delta,y=dy/length*delta;a[0]-=wa*x;a[1]-=wa*y;b[0]+=wb*x;b[1]+=wb*y;
 }
 chain.maxStretch=1;chain.peak=0;
 for(let i=1;i<p.length;i++){
  for(let axis=0;axis<2;axis++)v[i][axis]=clamp((p[i][axis]-before[i][axis])/h,-130,130);
  chain.maxStretch=Math.max(chain.maxStretch,Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1])/chain.lengths[i-1]);
  chain.peak=Math.max(chain.peak,Math.hypot(p[i][0]-r[i][0],p[i][1]-r[i][1]));
 }
 return chain;
}
export function sampleChain(chain,f){
 if(!chain)return[0,0];const u=clamp(f,0,1)*(chain.points.length-1),i=Math.min(chain.points.length-2,Math.floor(u)),t=u-i;
 // Interpolate displacement in the artwork frame; UVs and alpha are unchanged.
 return[0,1].map(a=>(chain.points[i][a]-chain.rest[i][a])*(1-t)+(chain.points[i+1][a]-chain.rest[i+1][a])*t);
}
export function resamplePath(path,count){
 const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths.at(-1)+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
 return Array.from({length:count},(_,k)=>{const distance=lengths.at(-1)*k/(count-1);let i=1;while(i<lengths.length-1&&lengths[i]<distance)i++;const t=(distance-lengths[i-1])/Math.max(1e-9,lengths[i]-lengths[i-1]);return[0,1].map(a=>path[i-1][a]+(path[i][a]-path[i-1][a])*t);});
}
