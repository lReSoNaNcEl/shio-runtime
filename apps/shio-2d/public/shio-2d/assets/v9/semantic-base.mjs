// Piecewise affine 2D rig. Every illustrated view uses the same semantic
// topology and reaches the same interpolated geometry before premultiplied
// accumulation. No optical flow, cosine squash, or drawing replacement switch.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const radians=v=>v*Math.PI/180;
const area=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function circleContains(a,b,c,p){
  const ax=a[0]-p[0],ay=a[1]-p[1],bx=b[0]-p[0],by=b[1]-p[1],cx=c[0]-p[0],cy=c[1]-p[1];
  const det=(ax*ax+ay*ay)*(bx*cy-by*cx)-(bx*bx+by*by)*(ax*cy-ay*cx)+(cx*cx+cy*cy)*(ax*by-ay*bx);
  return det*Math.sign(area(a,b,c))>1e-8;
}
/** Deterministic Bowyer-Watson. Explicit triangles in the manifest take priority. */
export function triangulate(points){
  if(points.length<3)return[];
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
  const d=Math.max(maxX-minX,maxY-minY,1),cx=(minX+maxX)/2,cy=(minY+maxY)/2,n=points.length;
  const p=[...points,[cx-32*d,cy-2*d],[cx,cy+32*d],[cx+32*d,cy-2*d]];
  let triangles=[[n,n+1,n+2]];
  for(let i=0;i<n;i++){
    const bad=triangles.filter(t=>circleContains(p[t[0]],p[t[1]],p[t[2]],p[i]));
    const edges=new Map();
    for(const t of bad)for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],key=a<b?a+':'+b:b+':'+a;if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);}
    const set=new Set(bad);triangles=triangles.filter(t=>!set.has(t));
    for(const [a,b]of edges.values())if(Math.abs(area(p[a],p[b],p[i]))>1e-8)triangles.push(area(p[a],p[b],p[i])>0?[a,b,i]:[b,a,i]);
  }
  return triangles.filter(t=>t.every(i=>i<n)).flat();
}
function worldPoints(view){
  if(view.worldPoints)return view.worldPoints.map(p=>p.slice());
  const [sx,sy,tx,ty]=view.transform??[1,1,0,0];
  return view.points.map(([x,y])=>[x*sx+tx,y*sy+ty]);
}
function triangleMinArea(a,b,ix){
  const at=t=>area(...ix.map(i=>mix(a[i],b[i],t))),a0=at(0),a1=at(1),ah=at(.5),q=2*(a1+a0-2*ah),l=a1-a0-q;
  const t=q>0?clamp(-l/(2*q),0,1):0;
  return {area:Math.min(a0,a1,at(t)),at:t};
}
/** Reports semantic folds, including ones between valid endpoint drawings.
 * Transparent-border triangles are reported separately from the face interior.
 * Never treats a merely finite mesh as evidence of good visual animation. */
export function validateSemanticTopology(config){
  if(config.cells?.length)return validateSemanticCells(config);
  const names=config.pointNames??[],front=config.views.find(v=>v.yaw===0&&v.pitch===0)??config.views[0];
  if(!front)throw Error('Semantic head has no views');
  const points=worldPoints(front),indices=config.triangles??triangulate(points),errors=[],folds=[],views=config.views.map(v=>({...v,world:worldPoints(v)}));
  for(const v of views){if(v.points.length!==names.length)errors.push(`${v.name}: ${v.points.length} points, expected ${names.length}`);if(v.world.some(p=>!p.every(Number.isFinite)))errors.push(`${v.name}: non-finite landmark`);}
  if(errors.length)return{valid:false,errors,folds,indices};
  const pairs=[];
  for(let i=0;i<views.length;i++)for(let j=i+1;j<views.length;j++){
    const a=views[i],b=views[j];
    if(Math.abs(a.yaw-b.yaw)<=45&&Math.abs(a.pitch-b.pitch)<=30)pairs.push([a,b]);
  }
  let minimum=Infinity;
  for(let k=0;k<indices.length;k+=3){
    let ix=indices.slice(k,k+3);if(area(...ix.map(i=>points[i]))<0)ix=[ix[0],ix[2],ix[1]];
    const n=ix.map(i=>names[i]??String(i));
    const transparent=n.every(s=>s.startsWith('border'));
    for(const [a,b]of pairs){
      const m=triangleMinArea(a.world,b.world,ix);minimum=Math.min(minimum,m.area);
      if(m.area<=.0001)folds.push({triangle:k/3,names:n,from:a.name,to:b.name,area:m.area,at:m.at,transparent});
    }
  }
  return{valid:errors.length===0&&folds.every(f=>f.transparent),errors,folds,minimumArea:minimum,indices};
}
export function validateSemanticCells(config,steps=16){
  const errors=[],folds=[],cells=[];let minimumArea=Infinity,trianglesSampled=0;
  for(const cell of config.cells){
    const find=(yaw,pitch)=>{const view=config.views.find(v=>v.yaw===yaw&&v.pitch===pitch);if(!view){errors.push(`Missing grid view ${yaw}, ${pitch}`);return null;}return worldPoints(view);};
    const vv=[find(cell.yaw[0],cell.pitch[0]),find(cell.yaw[1],cell.pitch[0]),find(cell.yaw[0],cell.pitch[1]),find(cell.yaw[1],cell.pitch[1])];
    if(vv.some(v=>!v))continue;let min=Infinity,count=0;
    for(let y=0;y<=steps;y++)for(let x=0;x<=steps;x++){
      const u=x/steps,v=y/steps,w=[(1-u)*(1-v),u*(1-v),(1-u)*v,u*v];
      const target=config.pointNames.map((_,i)=>[vv.reduce((a,p,j)=>a+p[i][0]*w[j],0),vv.reduce((a,p,j)=>a+p[i][1]*w[j],0)]);
      for(let i=0;i<cell.triangles.length;i+=3){const ids=cell.triangles.slice(i,i+3),value=area(...ids.map(j=>target[j]));min=Math.min(value,min);trianglesSampled++;if(value<=.00001){count++;if(folds.length<20)folds.push({yaw:cell.yaw,pitch:cell.pitch,u,v,names:ids.map(i=>config.pointNames[i]),area:value});}}
    }
    minimumArea=Math.min(minimumArea,min);cells.push({yaw:cell.yaw,pitch:cell.pitch,minimumArea:min,folds:count});
  }
  return{valid:errors.length===0&&cells.every(c=>c.folds===0),errors,folds,minimumArea,trianglesSampled,cells};
}
function binding(g,program,positions,uv,indices){
  const vao=g.createVertexArray();g.bindVertexArray(vao);const buffers=[];
  for(const [name,data]of [['pos',positions],['uv',uv]]){const b=g.createBuffer();buffers.push(b);g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,data,name==='pos'?g.DYNAMIC_DRAW:g.STATIC_DRAW);const location=g.getAttribLocation(program,name);g.enableVertexAttribArray(location);g.vertexAttribPointer(location,2,g.FLOAT,false,0,0);}
  const index=g.createBuffer();buffers.push(index);g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,index);g.bufferData(g.ELEMENT_ARRAY_BUFFER,indices,g.STATIC_DRAW);
  return{vao,buffers,count:indices.length};
}
function texture(g){
  const t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);return t;
}
/** Source-agnostic API: renderer.gl/program/camera/opacity/canvas; images keyed
 * by each view.name; model.head.semantic contains pixel landmarks and transforms.
 * All arrays represent the same semantic landmark order in every source image. */
export class SemanticHeadSurface{
  constructor(renderer,images,config=renderer.model.head.semantic){
    if(!config?.views?.length)throw Error('No semantic head registration');
    this.r=renderer;this.g=renderer.gl;this.config=config;this.images=images;this.names=config.pointNames;this.id=new Map(this.names.map((s,i)=>[s,i]));this.disposed=false;
    const g=this.g,front=config.views.find(v=>v.yaw===0&&v.pitch===0)??config.views[0];
    const shader=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
    const vertex=shader(g.VERTEX_SHADER,'#version 300 es\nin vec2 pos;in vec2 uv;out vec2 tex;uniform vec4 camera;void main(){vec2 p=(pos-camera.xy)/camera.zw;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0,1);tex=uv;}');
    const fragment=shader(g.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;in vec2 tex;uniform sampler2D art;uniform float opacity;out vec4 color;void main(){if(any(lessThan(tex,vec2(0.)))||any(greaterThan(tex,vec2(1.)))){color=vec4(0.);return;}color=texture(art,tex)*opacity;}');
    this.program=g.createProgram();g.attachShader(this.program,vertex);g.attachShader(this.program,fragment);g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));g.deleteShader(vertex);g.deleteShader(fragment);this.camera=g.getUniformLocation(this.program,'camera');this.opacity=g.getUniformLocation(this.program,'opacity');
    this.indices=config.triangles??triangulate(worldPoints(front));
    this.diagnostics=validateSemanticTopology({...config,triangles:this.indices});
    // Production registration may explicitly accept silhouette changes or hidden
    // far-eye patches. The diagnostic remains inspectable even in that mode.
    if(config.requireValidTopology&& !this.diagnostics.valid)throw Error('Semantic head registration contains folded triangles: '+JSON.stringify(this.diagnostics.folds.slice(0,5)));
    this.samples=[];
    const subdivide=clamp(Math.round(config.subdivisions??3),1,8);
    for(let k=0;k<this.indices.length;k+=3){
      const tri=this.indices.slice(k,k+3),rows=[];
      for(let a=0;a<=subdivide;a++){const row=[];for(let b=0;b<=subdivide-a;b++){row.push(this.samples.length);this.samples.push({tri,weight:[a/subdivide,b/subdivide,1-(a+b)/subdivide]});}rows.push(row);}
      if(!this.meshIndices)this.meshIndices=[];
      for(let a=0;a<subdivide;a++)for(let b=0;b<subdivide-a;b++){
        this.meshIndices.push(rows[a][b],rows[a+1][b],rows[a][b+1]);
        if(b<subdivide-a-1)this.meshIndices.push(rows[a+1][b],rows[a+1][b+1],rows[a][b+1]);
      }
    }
    const indices=new Uint32Array(this.meshIndices);
    this.views=config.views.map(v=>{
      const image=images[v.name];if(!image)throw Error('Missing semantic head image '+v.name);
      const pixelWidth=Math.round(v.pixelWidth??image.naturalWidth??image.width),pixelHeight=Math.round(v.pixelHeight??image.naturalHeight??image.height);
      if(!Number.isFinite(pixelWidth)||!Number.isFinite(pixelHeight)||pixelWidth<1||pixelHeight<1)throw Error('Invalid head paint resolution '+v.name);
      const width=v.width??pixelWidth,height=v.height??pixelHeight;
      return{...v,width,height,pixelWidth,pixelHeight,scaleX:pixelWidth/width,scaleY:pixelHeight/height,world:worldPoints(v),canvas:null,c:null,base:null,texture:null,uploaded:false};
    });
    this.yaws=[...new Set(this.views.map(v=>v.yaw))].sort((a,b)=>a-b);this.pitches=[...new Set(this.views.map(v=>v.pitch))].sort((a,b)=>a-b);
    this.output=texture(g);this.framebuffer=g.createFramebuffer();this.viewOutput=texture(g);this.viewFramebuffer=g.createFramebuffer();this.quadPositions=new Float32Array(8);this.quad=binding(g,this.program,this.quadPositions,new Float32Array([0,1,1,1,0,0,1,0]),new Uint32Array([0,1,2,1,3,2]));
    this.target=Array.from({length:this.names.length},()=>[0,0]);this.sharedPositions=new Float32Array(this.samples.length*2);this.cellMeshes=new Map();this.viewCache=new Map();this.cacheLimit=clamp(Math.round(config.viewCacheLimit??8),4,24);this.defaultGeometry={samples:this.samples,positions:this.sharedPositions,indices,draws:new Map()};this.size='';
  }
  ensureView(index){
    const view=this.views[index];this.viewCache.delete(index);this.viewCache.set(index,true);
    if(!view.c){
      const image=this.images[view.name],canvas=document.createElement('canvas');canvas.width=view.pixelWidth;canvas.height=view.pixelHeight;
      const c=canvas.getContext('2d',{willReadFrequently:true});c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(image,0,0,view.pixelWidth,view.pixelHeight);
      Object.assign(view,{canvas,c,base:c.getImageData(0,0,view.pixelWidth,view.pixelHeight),texture:texture(this.g),uploaded:false,paintKey:null});
    }
    while(this.viewCache.size>this.cacheLimit){const oldest=this.viewCache.keys().next().value;this.viewCache.delete(oldest);this.releaseView(oldest);}
    return view;
  }
  releaseView(index){
    const g=this.g,view=this.views[index];if(view.texture)g.deleteTexture(view.texture);if(view.canvas)view.canvas.width=view.canvas.height=1;
    Object.assign(view,{canvas:null,c:null,base:null,texture:null,uploaded:false,paintKey:null});
    for(const geometry of [this.defaultGeometry,...this.cellMeshes.values()]){const draw=geometry.draws.get(index);if(draw){for(const b of draw.buffers)g.deleteBuffer(b);g.deleteVertexArray(draw.vao);geometry.draws.delete(index);}}
  }
  drawing(geometry,index){
    if(geometry.draws.has(index))return geometry.draws.get(index);
    const view=this.views[index],uv=new Float32Array(geometry.positions.length);
    for(let i=0;i<geometry.samples.length;i++){const {tri,weight}=geometry.samples[i];for(let j=0;j<3;j++){uv[i*2]+=view.points[tri[j]][0]/view.width*weight[j];uv[i*2+1]+=view.points[tri[j]][1]/view.height*weight[j];}}
    const draw=binding(this.g,this.program,geometry.positions,uv,geometry.indices);geometry.draws.set(index,draw);return draw;
  }
  geometry(state){
    if(!this.config.cells?.length)return this.defaultGeometry;
    const yaw=clamp(state.yaw??0,this.yaws[0],this.yaws.at(-1)),pitch=clamp(state.pitch??0,this.pitches[0],this.pitches.at(-1));
    const index=this.config.cells.findIndex(c=>yaw>=c.yaw[0]&&yaw<=c.yaw[1]&&pitch>=c.pitch[0]&&pitch<=c.pitch[1]);
    if(index<0)throw Error('Semantic head pose has no local topology');
    this.activeCell=index;if(this.cellMeshes.has(index))return this.cellMeshes.get(index);
    const topology=this.config.cells[index].triangles,samples=[],indices=[],subdivide=clamp(Math.round(this.config.subdivisions??3),1,8),g=this.g;
    for(let k=0;k<topology.length;k+=3){
      const tri=topology.slice(k,k+3),rows=[];
      for(let a=0;a<=subdivide;a++){const row=[];for(let b=0;b<=subdivide-a;b++){row.push(samples.length);samples.push({tri,weight:[a/subdivide,b/subdivide,1-(a+b)/subdivide]});}rows.push(row);}
      for(let a=0;a<subdivide;a++)for(let b=0;b<subdivide-a;b++){indices.push(rows[a][b],rows[a+1][b],rows[a][b+1]);if(b<subdivide-a-1)indices.push(rows[a+1][b],rows[a+1][b+1],rows[a][b+1]);}
    }
    const positions=new Float32Array(samples.length*2),result={samples,positions,indices:new Uint32Array(indices),draws:new Map()};this.cellMeshes.set(index,result);return result;
  }
  selection(yaw,pitch){
    const span=(values,v)=>{v=clamp(v,values[0],values.at(-1));let i=0;while(i<values.length-2&&values[i+1]<v)i++;const a=values[i],b=values[Math.min(i+1,values.length-1)];return[a,b,a===b?0:(v-a)/(b-a)];};
    const [a,b,x]=span(this.yaws,yaw),[c,d,y]=span(this.pitches,pitch),requested=[[a,c,(1-x)*(1-y)],[b,c,x*(1-y)],[a,d,(1-x)*y],[b,d,x*y]],merged=new Map();
    for(const [yaw,pitch,w]of requested){if(w<.000001)continue;const i=this.views.findIndex(v=>v.yaw===yaw&&v.pitch===pitch);if(i<0)throw Error(`Semantic head missing grid view yaw=${yaw}, pitch=${pitch}`);merged.set(i,(merged.get(i)??0)+w);}
    return [...merged.entries()];
  }
  point(view,name,fallback){const i=this.id.get(name);return i===undefined?fallback:view.points[i];}
  worldPoint(name,fallback){const i=this.id.get(name);return i===undefined?fallback:this.target[i];}
  getAnchor(name,state){
    const id=this.id.get(name);if(id===undefined)return null;
    if(!state)return this.target[id].slice();
    const selected=this.selection(state.yaw??0,state.pitch??0);let x=0,y=0;
    for(const [index,weight]of selected){x+=this.views[index].world[id][0]*weight;y+=this.views[index].world[id][1]*weight;}
    return this.transform(x,y,state);
  }
  eye(view,side){
    const prefix=side?'eyeR':'eyeL',e=view.eyes?.[side]??{};
    const center=this.point(view,e.center??prefix+'Center',[view.width/2,view.height*.55]);
    const inner=this.point(view,e.inner??prefix+'Inner',center),outer=this.point(view,e.outer??prefix+'Outer',center),top=this.point(view,e.top??prefix+'Top',center),bottom=this.point(view,e.bottom??prefix+'Bottom',center);
    return{center,rx:Math.max(2,Math.abs(inner[0]-outer[0])*.55),ry:Math.max(2,Math.hypot(bottom[0]-top[0],bottom[1]-top[1])*.65)};
  }
  skin(view,x,y){
    const xx=Math.round(clamp(x*view.scaleX,1,view.pixelWidth-2)),yy=Math.round(clamp(y*view.scaleY,1,view.pixelHeight-2));let r=0,g=0,b=0,a=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((yy+dy)*view.pixelWidth+xx+dx)*4,w=view.base.data[i+3]/255;r+=view.base.data[i]*w;g+=view.base.data[i+1]*w;b+=view.base.data[i+2]*w;a+=w;}
    return a>.1?[r/a,g/a,b/a].map(Math.round):[251,233,226];
  }
  skinPatch(view,center,rx,ry,amount){
    if(amount<=.001)return;
    const c=view.c,[x,y]=center,skin=this.skin(view,x+rx*.1,y+ry*1.35);
    c.save();c.translate(x,y);c.scale(rx,ry);const gradient=c.createRadialGradient(0,0,.15,0,0,1.3);gradient.addColorStop(0,`rgba(${skin[0]},${skin[1]},${skin[2]},${amount})`);gradient.addColorStop(.75,`rgba(${skin[0]},${skin[1]},${skin[2]},${amount})`);gradient.addColorStop(1,`rgba(${skin[0]},${skin[1]},${skin[2]},0)`);c.fillStyle=gradient;c.fillRect(-1.3,-1.3,2.6,2.6);c.restore();
  }
  paint(view,state){
    const c=view.c,f=state.face??{},farSide=(state.yaw??0)>0?(this.config.farEyePositive??0):1-(this.config.farEyePositive??0),occlusion=this.config.eyeOcclusion===false?0:smooth(this.config.eyeOcclusionStart??60,this.config.eyeOcclusionEnd??84,Math.abs(state.yaw??0));
    const open=clamp(Math.max(state.mouth??0,f.open??0),0,1),quantize=x=>Math.round(x*500)/500;
    const paintKey=[quantize(f.lidL??1),quantize(f.lidR??1),quantize(f.blush??0),quantize(open),quantize(f.smile??0),state.viseme,farSide,quantize(occlusion)].join(':');
    if(view.paintKey===paintKey)return false;view.paintKey=paintKey;
    c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,view.pixelWidth,view.pixelHeight);c.setTransform(view.scaleX,0,0,view.scaleY,0,0);c.drawImage(this.images[view.name],0,0,view.width,view.height);
    for(let side=0;side<2;side++){
      if(view.eyeVisible?.[side]===false)continue;
      const e=this.eye(view,side),lid=clamp(side?f.lidR??1:f.lidL??1,.06,1.35),closed=1-smooth(.12,.36,lid),hidden=side===farSide?occlusion:0;
      // The hidden eye's painted iris is removed before accumulation. It cannot
      // create a second floating iris when the far side passes behind the nose.
      if(hidden>.001)this.skinPatch(view,e.center,e.rx*1.03,e.ry*1.08,hidden);
      if(closed>.001&&hidden<.999){
        this.skinPatch(view,e.center,e.rx,e.ry,closed*(1-hidden));
        c.save();c.translate(...e.center);c.globalAlpha=closed*(1-hidden);c.lineWidth=Math.max(.9,e.rx*.085);c.strokeStyle='#4b2529';c.lineCap='round';c.beginPath();c.moveTo(-e.rx*.85,-e.ry*.04);c.quadraticCurveTo(0,e.ry*.48,e.rx*.85,-e.ry*.04);c.stroke();c.restore();
      }
      const blush=clamp(f.blush??0,0,1)*(1-hidden);
      if(blush>.001){const [x,y]=e.center,rr=e.rx*.85,gradient=c.createRadialGradient(x,y+e.ry*1.4,1,x,y+e.ry*1.4,rr);gradient.addColorStop(0,`rgba(205,77,87,${blush*.16})`);gradient.addColorStop(1,'rgba(205,77,87,0)');c.fillStyle=gradient;c.fillRect(x-rr,y+e.ry*1.4-rr,rr*2,rr*2);}
    }
    if(open>.025){
      const m=view.mouth??{},center=this.point(view,m.center??'mouthCenter',[view.width/2,view.height*.66]),left=this.point(view,m.left??'mouthL',center),right=this.point(view,m.right??'mouthR',center),width=Math.max(4,Math.hypot(right[0]-left[0],right[1]-left[1]));
      const amount=smooth(.025,.18,open);this.skinPatch(view,center,width*.7,width*.3,amount);
      const name=state.viseme==='o'||state.viseme==='u'?'o':(f.smile??0)>.4?'laughing':state.viseme==='e'?'e':'a',image=this.images['ink-mouth-'+name];
      if(image){const w=width*(name==='o'?.9:1.25),h=width*.85*open;c.save();c.translate(...center);c.rotate(Math.atan2(right[1]-left[1],right[0]-left[0]));c.globalAlpha=amount;c.drawImage(image,-w/2,-h/2,w,h);c.restore();}
    }
    if(view.bottomFade){const [start,end]=view.bottomFade;c.save();c.globalCompositeOperation='destination-in';const gradient=c.createLinearGradient(0,start,0,end);gradient.addColorStop(0,'rgba(0,0,0,1)');gradient.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=gradient;c.fillRect(0,0,view.width,view.height);c.restore();}
    return true;
  }
  expression(x,y,state){
    const f=state.face??{},yaw=state.yaw??0,farSide=yaw>0?(this.config.farEyePositive??0):1-(this.config.farEyePositive??0),occlusion=this.config.eyeOcclusion===false?0:smooth(this.config.eyeOcclusionStart??60,this.config.eyeOcclusionEnd??84,Math.abs(yaw));
    for(let side=0;side<2;side++){
      const prefix=side?'eyeR':'eyeL',center=this.worldPoint(prefix+'Center',[side?572:513,174]),inner=this.worldPoint(prefix+'Inner',center),outer=this.worldPoint(prefix+'Outer',center),top=this.worldPoint(prefix+'Top',center),bottom=this.worldPoint(prefix+'Bottom',center);
      const rx=Math.max(1,Math.abs(inner[0]-outer[0])*.6),ry=Math.max(1,Math.hypot(bottom[0]-top[0],bottom[1]-top[1])*.75),dx=x-center[0],dy=y-center[1],visible=side===farSide?1-occlusion:1;
      const eye=(1-smooth(.7,1.2,Math.hypot(dx/rx,dy/ry)))*visible,lid=clamp(side?f.lidR??1:f.lidL??1,.06,1.35);y+=dy*(lid-1)*eye;
      const iris=(1-smooth(.35,1.1,Math.hypot(dx/(rx*.48),dy/(ry*.85))))*visible;x+=clamp(f.gazeX??0,-1,1)*Math.min(2.1,rx*.12)*iris;y+=clamp(f.gazeY??0,-1,1)*Math.min(1.3,ry*.12)*iris;
      const browCenter=this.worldPoint(side?'browRCenter':'browLCenter',[center[0],center[1]-22]),brow=1-smooth(.5,1.2,Math.hypot((x-browCenter[0])/Math.max(8,rx),(y-browCenter[1])/8));
      y+=(clamp(f.brow??0,-1,1)*2.6+clamp(f.tilt??0,-1,1)*dx*.09*(side?1:-1))*brow*visible;
    }
    const m=this.worldPoint('mouthCenter',[542,210]),dx=x-m[0],dy=y-m[1],weight=1-smooth(.5,1.2,Math.hypot(dx/17,dy/9));y-=clamp(f.smile??0,-1,1)*Math.min(2.8,(dx/12)**2*1.5)*weight;
    return[x,y];
  }
  transform(x,y,state){
    const [px,py]=this.config.worldPivot??[542,240];
    const earWeight=1-smooth(55,115,y),ear=state.ears?.[x<px?0:1]??0;x+=ear*.25*earWeight;
    const lock=smooth(55,105,Math.abs(x-px))*smooth(175,295,y);x+=clamp(state.hairChains?.[x<px?0:4]?.[0]??0,-6,6)*.35*lock;
    let a=radians(clamp(state.roll??0,-20,20)),dx=x-px,dy=y-py;x=px+dx*Math.cos(a)-dy*Math.sin(a);y=py+dx*Math.sin(a)+dy*Math.cos(a);
    a=radians(state.bodyRoll??0);dx=x-542;dy=y-700;
    return[542+dx*Math.cos(a)-dy*Math.sin(a)+(state.pelvisX??0)+(state.shoulderX??0),700+dx*Math.sin(a)+dy*Math.cos(a)+(state.pelvisY??0)+(state.breath??0)];
  }
  sourceSelection(selected,state){return selected;}
  render(camera,state){
    if(this.disposed)return;const g=this.g,r=this.r,W=r.canvas.width,H=r.canvas.height,key=W+'x'+H;
    if(this.size!==key){this.size=key;for(const [texture,framebuffer]of [[this.output,this.framebuffer],[this.viewOutput,this.viewFramebuffer]]){g.bindTexture(g.TEXTURE_2D,texture);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,W,H,0,g.RGBA,g.UNSIGNED_BYTE,null);g.bindFramebuffer(g.FRAMEBUFFER,framebuffer);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,texture,0);if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error('Semantic head render target unavailable');}}
    const selected=this.selection(state.yaw??0,state.pitch??0);this.activeViews=selected.map(([i,weight])=>({name:this.views[i].name,weight}));
    for(let i=0;i<this.target.length;i++){const p=this.target[i];p[0]=p[1]=0;for(const [index,weight]of selected){p[0]+=this.views[index].world[i][0]*weight;p[1]+=this.views[index].world[i][1]*weight;}}
    // Every view shares these positions, so aligned eyes, nose, jaw and hair
    // anchors cannot turn into separate drifting crossfade copies.
    const geometry=this.geometry(state),positions=geometry.positions;
    for(let i=0;i<geometry.samples.length;i++){const {tri,weight}=geometry.samples[i];let x=0,y=0;for(let j=0;j<3;j++){x+=this.target[tri[j]][0]*weight[j];y+=this.target[tri[j]][1]*weight[j];}[x,y]=this.expression(x,y,state);[x,y]=this.transform(x,y,state);positions[i*2]=x;positions[i*2+1]=y;}
    g.useProgram(this.program);g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);g.viewport(0,0,W,H);g.clear(g.COLOR_BUFFER_BIT);g.uniform4f(this.camera,...camera);
    const [x,y,w,h]=camera;this.quadPositions.set([x,y,x+w,y,x,y+h,x+w,y+h]);g.bindVertexArray(this.quad.vao);g.bindBuffer(g.ARRAY_BUFFER,this.quad.buffers[0]);g.bufferSubData(g.ARRAY_BUFFER,0,this.quadPositions);
    for(const [index,weight]of this.sourceSelection(selected,state)){
      const view=this.ensureView(index),draw=this.drawing(geometry,index),painted=this.paint(view,state);
      // Assemble each source with ordinary premultiplied alpha first. Additive
      // accumulation is only for complete weighted views; adding overlapping
      // source triangles directly would brighten even an identical endpoint.
      g.bindFramebuffer(g.FRAMEBUFFER,this.viewFramebuffer);g.clear(g.COLOR_BUFFER_BIT);g.blendFunc(g.ONE,g.ONE_MINUS_SRC_ALPHA);g.uniform1f(this.opacity,1);
      g.bindVertexArray(draw.vao);g.bindBuffer(g.ARRAY_BUFFER,draw.buffers[0]);g.bufferSubData(g.ARRAY_BUFFER,0,positions);g.bindTexture(g.TEXTURE_2D,view.texture);if(painted||!view.uploaded){g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,view.canvas);view.uploaded=true;}g.drawElements(g.TRIANGLES,draw.count,g.UNSIGNED_INT,0);
      g.bindFramebuffer(g.FRAMEBUFFER,this.framebuffer);g.blendFunc(g.ONE,g.ONE);g.uniform1f(this.opacity,weight);g.bindVertexArray(this.quad.vao);g.bindTexture(g.TEXTURE_2D,this.viewOutput);g.drawElements(g.TRIANGLES,this.quad.count,g.UNSIGNED_INT,0);
    }
    g.bindFramebuffer(g.FRAMEBUFFER,null);g.blendFunc(g.ONE,g.ONE_MINUS_SRC_ALPHA);g.uniform1f(this.opacity,1);g.bindVertexArray(this.quad.vao);g.bindTexture(g.TEXTURE_2D,this.output);g.drawElements(g.TRIANGLES,this.quad.count,g.UNSIGNED_INT,0);g.useProgram(r.program);g.uniform4f(r.camera,...camera);g.uniform1f(r.opacity,1);
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;const g=this.g;
    for(let i=0;i<this.views.length;i++)this.releaseView(i);this.viewCache.clear();this.cellMeshes.clear();
    for(const b of this.quad.buffers)g.deleteBuffer(b);g.deleteVertexArray(this.quad.vao);g.deleteFramebuffer(this.framebuffer);g.deleteTexture(this.output);g.deleteFramebuffer(this.viewFramebuffer);g.deleteTexture(this.viewOutput);g.deleteProgram(this.program);this.views=[];this.target=[];this.samples=[];
  }
}
