import {projectTorso,torsoWeight} from '../v16/torso-motion-v16.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rad=Math.PI/180;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const rotate=(x,y,p,a)=>{const c=Math.cos(a),s=Math.sin(a),dx=x-p[0],dy=y-p[1];return[p[0]+dx*c-dy*s,p[1]+dx*s+dy*c];};
export const LEG_REST=Object.freeze([
 {hip:[478,650],knee:[492,963],ankle:[507,1190],sole:[507,1355]},
 {hip:[605,650],knee:[588,963],ankle:[575,1190],sole:[575,1355]},
]);
function root(point,restY,p,inverse=false,body=false){
 const weight=body?1:1-smooth(708,1170,restY),angle=(p.bodyRoll??0)*weight*rad;
 const tx=(p.pelvisX??0)*weight+(p.shoulderX??0)*(1-smooth(320,700,restY));
 const ty=(p.pelvisY??0)*weight+(p.breath??0)*(1-smooth(500,750,restY))-(p.shoulderLift??0)*(1-smooth(350,620,restY));
 if(inverse)return rotate(point[0]-tx,point[1]-ty,[542,700],-angle);
 const a=rotate(...point,[542,700],angle);return[a[0]+tx,a[1]+ty];
}
function inverseTorso(x,y,restY,p){
 const w=torsoWeight(restY);
 [x,y]=rotate(x,y,[542,650],-(p.hipRoll??0)*(1-w)*rad);
 [x,y]=rotate(x,y,[542,590],-(p.upperLean??0)*w*rad);
 const a=(p.torsoYaw??0)*w*rad,b=(p.torsoPitch??0)*w*rad,depth=48*w;
 const dx=(x-542-depth*Math.sin(a))/Math.cos(a),z=depth*Math.cos(a)-dx*Math.sin(a);
 return[542+dx,590+(y-590+z*Math.sin(b))/Math.cos(b)];
}
function solve(rest,hip,ankle,kneeHint,lateralLimit=Infinity){
 const zRest=18,l1=Math.hypot(rest.knee[0]-rest.hip[0],rest.knee[1]-rest.hip[1],zRest),l2=Math.hypot(rest.ankle[0]-rest.knee[0],rest.ankle[1]-rest.knee[1],zRest);
 const dx=ankle[0]-hip[0],dy=ankle[1]-hip[1],distance=Math.max(1,Math.hypot(dx,dy)),scale=Math.max(1,distance/(l1+l2-.001)),a=l1*scale,b=l2*scale;
 const ux=dx/distance,uy=dy/distance,along=clamp((a*a-b*b+distance*distance)/(2*distance),0,distance),radius=Math.sqrt(Math.max(0,a*a-along*along));
 const rdx=rest.ankle[0]-rest.hip[0],rdy=rest.ankle[1]-rest.hip[1],rd=Math.hypot(rdx,rdy),rx=rdx/rd,ry=rdy/rd;
 const restLateral=-(rest.knee[0]-rest.hip[0])*ry+(rest.knee[1]-rest.hip[1])*rx;
 const lateral=clamp(restLateral+kneeHint*.75,-Math.min(radius*.9,lateralLimit),Math.min(radius*.9,lateralLimit));
 const knee=[hip[0]+ux*along-uy*lateral,hip[1]+uy*along+ux*lateral],depth=Math.sqrt(Math.max(0,radius*radius-lateral*lateral));
 return{hip,knee,ankle,kneeDepth:depth,upperLength:a,lowerLength:b,stretch:scale,rest};
}
// C2 rounded positive part: the correction always covers the reach deficit.
// This constrains the shared root before the one existing IK solve; bones do
// not stretch to compensate for a tiny upward breathing/weight-shift offset.
function softPositive(x,e=.5){if(x<=-e)return 0;if(x>=e)return x;const t=(x+e)/(2*e);return 2*e*(t**6-3*t**5+2.5*t**4);}
export function constrainSupport(p){
 let required=-Infinity;
 for(let side=0;side<2;side++){const foot=p.legs?.[side]??{};if((foot.lift??0)>=.6)continue;const r=LEG_REST[side],hip=root(projectTorso(...r.hip,p,torsoWeight(r.hip[1])),r.hip[1],p,false,true),sole=[r.sole[0]+(foot.x??0),r.sole[1]-(foot.lift??0)],ankle=rotate(r.ankle[0]+(foot.x??0),r.ankle[1]-(foot.lift??0),sole,(foot.roll??0)*rad),reach=Math.hypot(r.knee[0]-r.hip[0],r.knee[1]-r.hip[1],18)+Math.hypot(r.ankle[0]-r.knee[0],r.ankle[1]-r.knee[1],18)-.03,dx=ankle[0]-hip[0],minimum=ankle[1]-Math.sqrt(Math.max(1,reach*reach-dx*dx)),need=minimum-hip[1];required=required===-Infinity?need:required+softPositive(need-required,.25);}
 p.supportCorrection=required===-Infinity?0:softPositive(required);p.pelvisY+=p.supportCorrection;
}
export function updateLegRig(host,p){
 p.lowerBody=LEG_REST.map((rest,side)=>{
  const foot=p.legs?.[side]??{},hip=root(projectTorso(...rest.hip,p,torsoWeight(rest.hip[1])),rest.hip[1],p,false,true),sole=[rest.sole[0]+(foot.x??0),rest.sole[1]-(foot.lift??0)];
  const ankle=rotate(rest.ankle[0]+(foot.x??0),rest.ankle[1]-(foot.lift??0),sole,(foot.roll??0)*rad);
  return{...solve(rest,hip,ankle,(foot.knee??0)+(side?1:-1)*Math.max(0,p.pelvisY??0)*.8+(p.torsoYaw??0)*.65,p.legFlow?14:Infinity),sole,footRoll:foot.roll??0,contact:foot.contact??true};
 });
}
function segment(x,y,a,b,c,d){
 const rx=b[0]-a[0],ry=b[1]-a[1],length=Math.hypot(rx,ry),ux=rx/length,uy=ry/length,along=(x-a[0])*ux+(y-a[1])*uy,lateral=-(x-a[0])*uy+(y-a[1])*ux;
 const dx=d[0]-c[0],dy=d[1]-c[1],n=Math.max(1,Math.hypot(dx,dy));
 return[c[0]+dx*along/length-dy/n*lateral,c[1]+dy*along/length+dx/n*lateral];
}
export function legWorld(x,y,layer,p){
 const side=layer.side<0?0:1,rig=p.lowerBody?.[side];if(!rig)return[x,y];
 const r=rig.rest,upper=segment(x,y,r.hip,r.knee,rig.hip,rig.knee),lower=segment(x,y,r.knee,r.ankle,rig.knee,rig.ankle);
 const blend=smooth(r.knee[1]-22,r.knee[1]+22,y);let xx=upper[0]+(lower[0]-upper[0])*blend,yy=upper[1]+(lower[1]-upper[1])*blend;
 const boot=rotate(x-r.sole[0]+rig.sole[0],y-r.sole[1]+rig.sole[1],rig.sole,rig.footRoll*rad),ankle=smooth(r.ankle[1]-27,r.ankle[1]+25,y);xx+=(boot[0]-xx)*ankle;yy+=(boot[1]-yy)*ankle;
 const soft=p.secondary?.thighs?.[side]??[0,0],axial=smooth(747,790,y)*(1-smooth(878,935,y)),cx=r.hip[0]+(r.knee[0]-r.hip[0])*clamp((y-r.hip[1])/(r.knee[1]-r.hip[1]),0,1),q=Math.abs(x-cx)/65,shape=Math.max(0,1-q*q)**3*axial;
 xx+=soft[0]*shape;yy+=soft[1]*shape;
 const attachment=1-smooth(730,830,y);if(attachment>0){const parent=root(projectTorso(x,y,p,torsoWeight(y)),y,p,false,true);xx+=(parent[0]-xx)*attachment;yy+=(parent[1]-yy)*attachment;}return[xx,yy];
}
// Return parent-local coordinates; the existing common torso/root stage then
// lands exactly on the solved world pose. Garters use this same owner function.
export function deformLeg(layer,x,y,p){
 if(!p.lowerBody)return[x,y];const world=legWorld(x,y,layer,p),local=root(world,y,p,true);return inverseTorso(...local,y,p);
}
export function legDelta(point,layer,p){if(!layer)return[0,0];const a=deformLeg(layer,...point,p);return[a[0]-point[0],a[1]-point[1]];}
