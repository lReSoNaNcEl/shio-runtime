import {paintFoxMouth} from '../v16/mouth-acting-v16.mjs';
import {ContinuousMaterial as FaceMaterial} from './hair-material-v22.mjs';
import {NeckBridge} from '../v16/neck-bridge-v16.mjs';
import {SemanticHeadSurface as SemanticBase} from '../v9/semantic-base.mjs';
import {headNeckOwnership} from '../v16/neck-ownership-v16.mjs';
import {ContinuousMaterial} from './hair-material-v22.mjs';
import {strandWeights,warpFrontHair} from '../v16/hair-motion-v16.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
export class SemanticHeadSurface extends SemanticBase{
 constructor(renderer,images,config=renderer.model.head.semantic){super(renderer,images,{...config,subdivisions:8});this.diagnostics.sourceBlend=true;this.diagnostics.faceMaterial='Original pose-specific artwork, reconstructed at 1024x1024; native front unchanged';this.diagnostics.materialInterpolation='registered UV; one surface, one fragment output';this.diagnostics.yawLimit=60;this.diagnostics.pitchLimit=30;this.material=new FaceMaterial(this.g);this.neckBridge=new NeckBridge(renderer,images);this.hairGeometry=new WeakMap();this.frontIndex=this.views.findIndex(v=>v.yaw===0&&v.pitch===0);const native=this.ensureView(this.frontIndex);this.frontWorld=native.world;this.rootIndices=['crown','bangLRoot','bangRRoot','templeLHair','templeRHair','hairLMid','hairRMid','hairLJaw','hairRJaw','hairLNeck','hairRNeck','jawL','chin','jawR','neckL','neckCenter','neckR'].map(n=>this.id.get(n));this.rootDeltas=new Float64Array(this.rootIndices.length*2);this.nativePixels=native.base.data.slice();this.nativeSize=[native.pixelWidth,native.pixelHeight];this.g.useProgram(renderer.program);}
 sourceSelection(selected,state){return selected;}
 preparePose(state){const roll=(state.roll??0)*Math.PI/180;this.rootCos=Math.cos(roll);this.rootSin=Math.sin(roll);if(this.preparedYaw===state.yaw&&this.preparedPitch===state.pitch)return;this.preparedYaw=state.yaw;this.preparedPitch=state.pitch;this.geometry(state);this.frameSelection=this.selection(clamp(state.yaw??0,-60,60),clamp(state.pitch??0,-30,30));for(let i=0;i<this.target.length;i++){const p=this.target[i];p[0]=p[1]=0;for(const [index,weight]of this.frameSelection){p[0]+=this.views[index].world[i][0]*weight;p[1]+=this.views[index].world[i][1]*weight;}}for(let k=0;k<this.rootIndices.length;k++){const i=this.rootIndices[k];this.rootDeltas[k*2]=this.target[i][0]-this.frontWorld[i][0];this.rootDeltas[k*2+1]=this.target[i][1]-this.frontWorld[i][1];}}

 rootWeights(x,y){const w=new Float64Array(this.rootIndices.length);let total=0;for(let k=0;k<w.length;k++){const p=this.frontWorld[this.rootIndices[k]],d=(x-p[0])**2+(y-p[1])**2;w[k]=1/(d+25)**2;total+=w[k];}for(let k=0;k<w.length;k++)w[k]/=Math.max(1e-20,total);return w;}
 mapSkull(x,y,state,global=false,binding=null){const weights=binding??this.rootWeights(x,y);let dx=0,dy=0;for(let k=0;k<weights.length;k++){dx+=this.rootDeltas[k*2]*weights[k];dy+=this.rootDeltas[k*2+1]*weights[k];}const xx=x+dx,yy=y+dy;if(global)return this.transform(xx,yy,state);const rx=xx-542,ry=yy-240,c=this.rootCos??1,s=this.rootSin??0;return[542+rx*c-ry*s,240+rx*s+ry*c];}

 frontBindings(geometry){
  if(this.hairGeometry.has(geometry))return this.hairGeometry.get(geometry);
  const info=geometry.samples.map(({tri,weight})=>{const rest=[0,0];for(let i=0;i<3;i++){rest[0]+=this.frontWorld[tri[i]][0]*weight[i];rest[1]+=this.frontWorld[tri[i]][1]*weight[i];}
   // A continuous spatial field replaces per-vertex colour classification.
   // The old colour threshold alternated between hair and skin at adjacent
   // vertices, which turned an increased breeze into a saw-tooth contour.
   const skin=Math.hypot((rest[0]-542)/63,(rest[1]-183)/63),protect=smooth(.99,1.20,skin);
   const polygon=['forehead','templeL','cheekL','jawL','chin','jawR','cheekR','templeR'].map(n=>this.frontWorld[this.id.get(n)]);let facial=false;
   for(let a=0,b=polygon.length-1;a<polygon.length;b=a++){const u=polygon[a],v=polygon[b];if((u[1]>rest[1])!==(v[1]>rest[1])&&rest[0]<(v[0]-u[0])*(rest[1]-u[1])/(v[1]-u[1])+u[0])facial=!facial;}
   let distance=Infinity;for(let a=0,b=polygon.length-1;a<polygon.length;b=a++){const u=polygon[a],v=polygon[b],dx=v[0]-u[0],dy=v[1]-u[1],f=clamp(((rest[0]-u[0])*dx+(rest[1]-u[1])*dy)/(dx*dx+dy*dy),0,1);distance=Math.min(distance,Math.hypot(rest[0]-u[0]-dx*f,rest[1]-u[1]-dy*f));}
   const faceGuard=facial?0:smooth(0,12,distance),weights=strandWeights(...rest).map((w,i)=>w*(i<3?1:protect)),sideWeights=weights.map((w,i)=>i<3?0:w*faceGuard);return{rest,weights,sideWeights};
  });this.hairGeometry.set(geometry,info);return info;
 }

 paint(view,state){
  const f=state.face??{},open=clamp(Math.max(state.mouth??0,f.open??0),0,1),weights=state.visemeWeights??{[state.viseme??'a']:1},total=Math.max(.001,Object.values(weights).reduce((a,b)=>a+b,0)),w=name=>(weights[name]??0)/total,round=clamp(w('o')+w('u')*.9+(f.round??0)*.7,0,1),wide=clamp(w('e')*.6+w('grin')*.8+w('laugh')*.5,0,1),smile=clamp(f.smile??0,-1,1),blush=clamp(f.blush??0,0,1),tears=clamp(f.tears??0,0,1),sparkle=clamp(f.sparkle??0,0,1),key=[open,round,wide,smile,blush,tears,sparkle,sparkle>.001?f.lidL??1:1,sparkle>.001?f.lidR??1:1].map(v=>Math.round(v*1000)).join(':');
  if(view.paintKey===key)return false;view.paintKey=key;const c=view.c;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,view.pixelWidth,view.pixelHeight);c.drawImage(this.images[view.name],0,0,view.pixelWidth,view.pixelHeight);
  if(!view.neckMask)view.neckMask=headNeckOwnership(view,(name,fallback)=>this.point(view,name,fallback));c.save();c.globalCompositeOperation='destination-out';c.drawImage(view.neckMask.canvas,0,0);c.restore();c.setTransform(view.scaleX,0,0,view.scaleY,0,0);
  if(blush>.001)this.paintBlush(view,blush);
  if(tears>.001||sparkle>.001)for(let side=0;side<2;side++){
   if(view.eyeVisible?.[side]===false)continue;const e=this.eye(view,side),[x,y]=e.center,lid=clamp(side?f.lidR??1:f.lidL??1,0,1.35);
   if(sparkle>.001){
    // Tiny iris highlights follow the eye UV deformation; no eye enlargement.
    const amount=sparkle*smooth(.12,.55,lid),r=e.rx*.055,xx=x+e.rx*.14,yy=y+e.ry*.14;c.save();c.globalAlpha=amount*.85;c.fillStyle='#fff8e9';c.beginPath();c.moveTo(xx,yy-r);c.quadraticCurveTo(xx+r*.2,yy-r*.2,xx+r*.72,yy);c.quadraticCurveTo(xx+r*.2,yy+r*.2,xx,yy+r);c.quadraticCurveTo(xx-r*.2,yy+r*.2,xx-r*.72,yy);c.quadraticCurveTo(xx-r*.2,yy-r*.2,xx,yy-r);c.fill();c.globalAlpha=amount*.65;c.beginPath();c.ellipse(x-e.rx*.13,y+e.ry*.28,r*.3,r*.3,0,0,Math.PI*2);c.fill();c.restore();
   }
   if(tears>.001){c.save();c.globalAlpha=tears*.55;c.fillStyle='#cce5ed';c.beginPath();c.ellipse(x+(side?1:-1)*e.rx*.75,y+e.ry*1.6,e.rx*.07,e.ry*.65,0,0,Math.PI*2);c.fill();c.restore();}
  }
  paintFoxMouth(this,view,{open,round,wide,smile});
  return true;
 }
 paintBlush(view,amount){
  const c=view.c,point=(name,fallback)=>this.point(view,name,fallback),left=point('templeL',[0,0]),right=point('templeR',[view.width,0]),cheekL=point('cheekL',left),cheekR=point('cheekR',right),jawL=point('jawL',cheekL),jawR=point('jawR',cheekR),chin=point('chin',[(left[0]+right[0])/2,jawL[1]]),forehead=point('forehead',[(left[0]+right[0])/2,left[1]-20]);
  c.save();c.beginPath();c.moveTo(...left);c.quadraticCurveTo(...forehead,...right);c.quadraticCurveTo(...cheekR,...jawR);c.quadraticCurveTo(...chin,...jawL);c.quadraticCurveTo(...cheekL,...left);c.closePath();c.clip();
  const bloom=(x,y,rx,ry,alpha)=>{c.save();c.translate(x,y);c.scale(rx,ry);const gradient=c.createRadialGradient(0,0,.04,0,0,1);gradient.addColorStop(0,`rgba(215,77,100,${alpha})`);gradient.addColorStop(.4,`rgba(218,87,110,${alpha*.72})`);gradient.addColorStop(1,'rgba(224,101,123,0)');c.fillStyle=gradient;c.fillRect(-1,-1,2,2);c.restore();};
  for(let side=0;side<2;side++){if(view.eyeVisible?.[side]===false)continue;const e=this.eye(view,side);bloom(e.center[0],e.center[1]+e.ry*1.37,e.rx*1.07,e.ry*.75,amount*.32);}
  const nose=point('noseTip',point('noseBridge',chin)),e=this.eye(view,0),e2=this.eye(view,1);bloom(nose[0],nose[1]-e.ry*.08,Math.max(e.rx,e2.rx)*.67,e.ry*.46,amount*.14);c.restore();
 }
 expression(x,y,state){
  const f=state.face??{};
  for(let side=0;side<2;side++){
   const name=side?'eyeR':'eyeL',center=this.worldPoint(name+'Center',[side?572:513,174]),inner=this.worldPoint(name+'Inner',center),outer=this.worldPoint(name+'Outer',center),top=this.worldPoint(name+'Top',center),bottom=this.worldPoint(name+'Bottom',center),rx=Math.max(1,Math.abs(inner[0]-outer[0])*.6),ry=Math.max(1,Math.hypot(bottom[0]-top[0],bottom[1]-top[1])*.75),dx=x-center[0],dy=y-center[1],lid=clamp(side?f.lidR??1:f.lidL??1,.015,1.35),compression=lid,eye=1-smooth(.65,1.24,Math.hypot(dx/rx,dy/ry)),closed=1-Math.min(1,lid),arc=(.06-Math.max(0,f.smile??0)*.16)*ry*Math.max(0,1-(dx/rx)**2);
   y+=(dy*(compression-1)+arc*closed)*eye;const iris=1-smooth(.35,1.1,Math.hypot(dx/(rx*.48),dy/(ry*.85))),focus=1-clamp(f.focus??0,0,1)*.35;x+=clamp(f.gazeX??0,-1,1)*Math.min(2.1,rx*.12)*iris*focus;y+=clamp(f.gazeY??0,-1,1)*Math.min(1.3,ry*.12)*iris*compression*focus;
   const browCenter=this.worldPoint(side?'browRCenter':'browLCenter',[center[0],center[1]-22]),brow=1-smooth(.5,1.2,Math.hypot((x-browCenter[0])/Math.max(8,rx),(y-browCenter[1])/8));y+=(clamp(f.brow??0,-1,1)*2.6+clamp(f.tilt??0,-1,1)*dx*.09*(side?1:-1))*brow;
  }
  const mouth=this.worldPoint('mouthCenter',[542,210]),dx=x-mouth[0],dy=y-mouth[1],weight=1-smooth(.5,1.2,Math.hypot(dx/17,dy/9)),open=Math.max(state.mouth??0,f.open??0);y-=clamp(f.smile??0,-1,1)*Math.min(2.8,(dx/12)**2*1.5)*weight*(1-smooth(.01,.1,open));return[x,y];
 }
 transform(x,y,state){
  for(let side=0;side<2;side++){
   const name=side?'earR':'earL',tip=this.worldPoint(name+'Tip',[side?588:500,11]),a=this.worldPoint(name+'BaseOuter',[side?622:466,108]),b=this.worldPoint(name+'BaseInner',[side?564:522,88]),base=[(a[0]+b[0])*.5,(a[1]+b[1])*.5],dx=tip[0]-base[0],dy=tip[1]-base[1],length=Math.max(10,Math.hypot(dx,dy)),ux=dx/length,uy=dy/length,px=x-base[0],py=y-base[1],d=px*ux+py*uy,lateral=-px*uy+py*ux,halfWidth=Math.max(8,Math.hypot(a[0]-b[0],a[1]-b[1])*.55),crown=this.worldPoint('crown',[543,76]),protect=smooth(1.1,1.5,Math.hypot((x-crown[0])/31,(y-crown[1]+14)/53)),weight=(1-smooth(.75,1.25,Math.abs(lateral)/halfWidth))*smooth(.08,.3,d/length)*protect;
   if(weight<.00001)continue;const t=clamp(d/length,0,1),bend=clamp(state.earBend?.[side]??0,-12,42)*Math.PI/180,spread=clamp((state.earSpread?.[side]??0)+(state.ears?.[side]??0),-25,25)*Math.PI/180;let bent=d,z=0;if(Math.abs(bend)>.00001){bent=length/bend*Math.sin(bend*t)+Math.max(0,d-length)*Math.cos(bend);z=length/bend*(1-Math.cos(bend*t))+Math.max(0,d-length)*Math.sin(bend);}
   const xx=ux*bent-uy*lateral,yy=uy*bent+ux*lateral,yaw=(state.yaw??0)*Math.PI/180,pitch=(state.pitch??0)*Math.PI/180;let tx=base[0]+xx*Math.cos(spread)-yy*Math.sin(spread)+z*Math.sin(yaw),ty=base[1]+xx*Math.sin(spread)+yy*Math.cos(spread)+z*Math.sin(pitch);const curl=clamp(state.earCurl?.[side]??0,0,1),fold=t*t*t;tx+=(side?1:-1)*11*curl*fold;ty+=8.5*curl*fold;x+=(tx-x)*weight;y+=(ty-y)*weight;
  }
  const [px,py]=this.config.worldPivot??[542,240],a=clamp(state.roll??0,-20,20)*Math.PI/180,dx=x-px,dy=y-py,xx=px+dx*Math.cos(a)-dy*Math.sin(a),yy=py+dx*Math.sin(a)+dy*Math.cos(a),body=(state.bodyRoll??0)*Math.PI/180,bx=xx-542,by=yy-700;
  return[542+bx*Math.cos(body)-by*Math.sin(body)+(state.pelvisX??0)+(state.shoulderX??0),700+bx*Math.sin(body)+by*Math.cos(body)+(state.pelvisY??0)+(state.breath??0)-(state.shoulderLift??0)];
 }
 render(camera,state){
  if(this.disposed)return;state={...state,yaw:clamp(state.yaw??0,-60,60),pitch:clamp(state.pitch??0,-30,30)};const g=this.g,r=this.r;this.preparePose(state);const geometry=this.geometry(state),positions=geometry.positions,hair=this.frontBindings(geometry);
  for(let i=0;i<geometry.samples.length;i++){const {tri,weight}=geometry.samples[i];let x=0,y=0;for(let j=0;j<3;j++){x+=this.target[tri[j]][0]*weight[j];y+=this.target[tri[j]][1]*weight[j];}// Side locks deform their mesh continuously. Bangs use a short UV flow above the eyes; the protected face has no side-lock weights.
[x,y]=warpFrontHair(x,y,hair[i].rest,hair[i].sideWeights,state);[x,y]=this.expression(x,y,state);[x,y]=this.transform(x,y,state);positions[i*2]=x;positions[i*2+1]=y;}
  this.activeViews=this.frameSelection.map(([i,weight])=>({name:this.views[i].name,weight}));this.neckBridge.render(camera,state,this);const materialSelection=this.frameSelection;this.material.render(camera,geometry,materialSelection,this,state);g.useProgram(r.program);g.uniform4f(r.camera,...camera);g.uniform1f(r.opacity,1);g.activeTexture(g.TEXTURE0);
 }

 projectHairRoot(x,y,state){
  // One affine scalp frame keeps all five rear locks continuous. An inverse-
  // distance field per vertex previously pinched the roots between landmarks.
  const key=[state.yaw,state.pitch,state.roll].join(':');if(this.hairFrameKey!==key){this.hairFrameKey=key;this.hairFrame=[[462,150],[622,150],[542,230]].map(p=>this.mapSkull(...p,state,false));}
  const v=(y-150)/80,h=(x-542)/160,w=[(1-v)*.5-h,(1-v)*.5+h,v],point=[0,0];for(let i=0;i<3;i++){point[0]+=this.hairFrame[i][0]*w[i];point[1]+=this.hairFrame[i][1]*w[i];}const turn=smooth(0,38,Math.abs(state.yaw??0))+smooth(0,24,Math.abs(state.pitch??0))*.55,tuck=(1-smooth(140,255,y))*Math.min(1,turn),center=this.hairFrame[2][0];point[0]+=(center-point[0])*tuck*.35;point[1]-=tuck*8;return point;
 }

 getAnchor(name,state){return super.getAnchor(name,state?{...state,yaw:clamp(state.yaw??0,-60,60),pitch:clamp(state.pitch??0,-30,30)}:state);}
 releaseView(index){const view=this.views[index];if(view.neckMask)view.neckMask.canvas.width=view.neckMask.canvas.height=1;view.neckMask=null;super.releaseView(index);}
 dispose(){if(this.disposed)return;this.neckBridge.dispose();this.material.dispose();this.nativePixels=null;super.dispose();}
 neutralInvariant(){const index=this.views.findIndex(v=>v.yaw===0&&v.pitch===0),view=this.ensureView(index);this.paint(view,{mouth:0,face:{smile:0}});const actual=view.c.getImageData(0,0,view.pixelWidth,view.pixelHeight).data,base=view.base.data;let changedChannels=0;for(let i=0;i<base.length;i++)if(actual[i]!==base[i])changedChannels++;return{changedChannels,source:view.name,pixelWidth:view.pixelWidth,pixelHeight:view.pixelHeight};}
}
export {SemanticHeadSurface as ShioHeadSurface};
