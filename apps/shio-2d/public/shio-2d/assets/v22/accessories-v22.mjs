const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*t*(10+t*(-15+6*t));};
export class RigidClothDetails{
 constructor(attachments=[]){this.attachments=attachments.map((a,i)=>({...a,index:i})).filter(a=>a.kind==='cloth');this.frames=new Map();}
 reset(){this.frames.clear();}
 deform(layer,restX,restY,point,state,base){let x=point[0],y=point[1];for(const a of this.attachments){if(a.side!==layer.side)continue;const start=a.pivot,end=[a.center[0],a.center[1]+a.radius[1]*.85],dx=end[0]-start[0],dy=end[1]-start[1],f=clamp(((restX-start[0])*dx+(restY-start[1])*dy)/(dx*dx+dy*dy),0,1),distance=Math.hypot(restX-start[0]-dx*f,restY-start[1]-dy*f),weight=1-smooth(a.radius[0],a.radius[0]+38,distance);if(weight<=0)continue;const key=layer.name+':'+a.index;let frame=this.frames.get(key);if(!frame){const p=base(...a.pivot),q=base(...a.center),angle=Math.atan2(q[1]-p[1],q[0]-p[0])-Math.atan2(a.center[1]-a.pivot[1],a.center[0]-a.pivot[0])+clamp(state.charms?.[a.index-1]??0,-3.2,3.2)*.45*Math.PI/180;frame={p,c:Math.cos(angle),s:Math.sin(angle)};this.frames.set(key,frame);}const u=restX-a.pivot[0],v=restY-a.pivot[1],target=[frame.p[0]+u*frame.c-v*frame.s,frame.p[1]+u*frame.s+v*frame.c];x+=(target[0]-point[0])*weight;y+=(target[1]-point[1])*weight;}return[x,y];}
 dispose(){this.frames.clear();this.attachments=[];}
}
