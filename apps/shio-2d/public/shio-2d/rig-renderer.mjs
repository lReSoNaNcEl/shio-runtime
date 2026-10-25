import {RigidClothDetails} from './assets/v22/accessories-v22.mjs';
import {ArmTransitionRenderer} from './assets/v22/arm-renderer-v22.mjs';
import {deformPanel} from './assets/v16/textiles-v16.mjs';
import {deformLeg} from './assets/v22/leg-rig-v22.mjs';
import {deformTorso} from './assets/v16/torso-motion-v16.mjs';
import {deformSecondary} from './assets/v22/secondary-motion-v22.mjs';
import {deformCreature} from './assets/v22/creature-motion-v22.mjs';
import {deformNeck} from './assets/v8/neck-attachment.mjs';
import {SemanticHeadSurface} from './assets/v22/head-on-torso-v22.mjs';
import {deformGarment} from './assets/v16/garment-motion-v16.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const radians=d=>d*Math.PI/180;
function rotate(x,y,p,a){const c=Math.cos(a),s=Math.sin(a),dx=x-p[0],dy=y-p[1];return[p[0]+dx*c-dy*s,p[1]+dx*s+dy*c];}
export class ShioRenderer{
  constructor(canvas,model,images,hairRig){
    this.hairRig=hairRig;this.clothDetails=new RigidClothDetails(model.physics?.attachments);
    this.canvas=canvas;this.model=model;this.parts=[];this.gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true});const g=this.gl;if(!g)throw Error('Для модели требуется WebGL 2');g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    const shader=(type,src)=>{const x=g.createShader(type);g.shaderSource(x,src);g.compileShader(x);if(!g.getShaderParameter(x,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(x));return x;};
    const vs=shader(g.VERTEX_SHADER,'#version 300 es\nin vec2 pos;in vec2 uv;out vec2 tex;uniform vec4 camera;void main(){vec2 p=(pos-camera.xy)/camera.zw;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0,1);tex=uv;}');
    const fs=shader(g.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;in vec2 tex;uniform sampler2D art;uniform float opacity;uniform vec4 sourceRect;uniform float neckSkinCut;out vec4 color;void main(){vec2 rest=sourceRect.xy+tex*sourceRect.zw;vec4 sampleArt=texture(art,tex);vec3 rgb=sampleArt.rgb/max(sampleArt.a,.001);if(neckSkinCut>.5&&rest.x>506.&&rest.x<580.&&rest.y<233.2-2.4*pow((rest.x-542.)/38.,2.))discard;color=sampleArt*opacity;}');
    this.program=g.createProgram();g.attachShader(this.program,vs);g.attachShader(this.program,fs);g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(this.program));g.deleteShader(vs);g.deleteShader(fs);g.useProgram(this.program);this.camera=g.getUniformLocation(this.program,'camera');this.opacity=g.getUniformLocation(this.program,'opacity');this.sourceRect=g.getUniformLocation(this.program,'sourceRect');this.neckSkinCut=g.getUniformLocation(this.program,'neckSkinCut');g.uniform1i(g.getUniformLocation(this.program,'art'),0);g.uniform1f(this.opacity,1);g.enable(g.BLEND);g.blendFunc(g.ONE,g.ONE_MINUS_SRC_ALPHA);g.clearColor(0,0,0,0);
    for(const l of model.layers){
      const step=l.kind==='head'||l.kind==='body'||l.kind==='arm-rest'||l.kind==='arm-pose'?4:l.kind==='ear'?5:8;
      const nx=Math.max(2,Math.ceil(l.width/step)),ny=Math.max(2,Math.ceil(l.height/step));let rest=new Float32Array((nx+1)*(ny+1)*2),uv=new Float32Array(rest.length),ix=[];
      for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){const i=y*(nx+1)+x;rest[i*2]=l.x+x/nx*l.width;rest[i*2+1]=l.y+y/ny*l.height;if(l.jointUV){const a=l.jointUV;uv[i*2]=(a.center[0]+(x/nx-.5)*(a.sampleExtent?.[0]??l.width)-a.rect[0])/a.rect[2];uv[i*2+1]=(a.center[1]+(y/ny-.5)*(a.sampleExtent?.[1]??l.height)-a.rect[1])/a.rect[3];}else{uv[i*2]=x/nx;uv[i*2+1]=y/ny;}if(x<nx&&y<ny){const b=i+nx+1;ix.push(i,i+1,b,i+1,b+1,b);}}
      const native=l.kind==='hair-lock'?hairRig.mesh(l.name):null;
      if(native){rest=native.rest;uv=new Float32Array(rest.length);ix=Array.from(native.indices);for(let i=0;i<rest.length;i+=2){uv[i]=(rest[i]-l.x)/l.width;uv[i+1]=(rest[i+1]-l.y)/l.height;}}
      const vao=g.createVertexArray();g.bindVertexArray(vao);const buffer=(name,data,usage)=>{const b=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,b);g.bufferData(g.ARRAY_BUFFER,data,usage);const loc=g.getAttribLocation(this.program,name);g.enableVertexAttribArray(loc);g.vertexAttribPointer(loc,2,g.FLOAT,false,0,0);return b;};
      const positions=rest.slice(),position=buffer('pos',positions,g.DYNAMIC_DRAW),uvBuffer=buffer('uv',uv,g.STATIC_DRAW),index=g.createBuffer();g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,index);g.bufferData(g.ELEMENT_ARRAY_BUFFER,new Uint32Array(ix),g.STATIC_DRAW);
      const texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,images[l.name]);
      this.parts.push({...l,rest,positions,position,uvBuffer,index,texture,vao,count:ix.length});
    }
    this.headSurface=new SemanticHeadSurface(this,images);this.armRenderer=new ArmTransitionRenderer(g,model,images);
  }
  head(x,y,s,kind='head'){
    const rx=x-542,ry=y-240,u=rx/97,v=(y-181)/84;
    const dome=Math.max(0,1-u*u-v*v);
    const depth=kind==='ear'?6:kind==='hair'?0:dome*dome*40+Math.exp(-((rx/22)**2+((y-194)/28)**2))*7;
    const yaw=radians(s.yaw),pitch=radians(s.pitch),xx=rx*Math.cos(yaw)+depth*Math.sin(yaw),z=-rx*Math.sin(yaw)+depth*Math.cos(yaw),yy=ry*Math.cos(pitch)-z*Math.sin(pitch);
    return rotate(542+xx,240+yy,[542,240],radians(s.roll));
  }
  deform(l,x,y,s,vertexIndex=-1,details=true){
    const t=s.time,restX=x,restY=y;
    [x,y]=deformGarment(l,x,y,s,this.model.physics);
    // Local attachment warps keep every painted chain attached to its own cloth
    // surface, without duplicating the original jewellery underneath it.
    for(let i=0;i<(this.model.physics?.attachments?.length??0);i++){
      const a=this.model.physics.attachments[i];if(a.kind==='cloth'||a.kind!==l.kind||(a.side&&a.side!==l.side))continue;
      const angle=i===0?clamp(s.bell??0,-9,9):clamp(s.charms?.[i-1]??0,-3.2,3.2);
      const dx=(x-a.center[0])/(a.radius[0]*1.9),dy=(y-a.center[1])/(a.radius[1]*1.25),distance=Math.sqrt(dx*dx+dy*dy),weight=1-smooth(.48,1,distance);
      if(weight>0){const p=rotate(x,y,a.pivot,radians(angle));x+=(p[0]-x)*weight;y+=(p[1]-y)*weight;}
    }
    if(l.kind==='head'){
      // Side locks lag independently, while the central face remains unchanged.
      const side=x<542?0:4,lock=smooth(48,100,Math.abs(x-542))*smooth(165,290,y);
      x+=(s.hairChains?.[side][0]??0)*.46*lock;
      [x,y]=this.head(x,y,s);
    }else if(l.kind==='ear'){
      const weight=smooth(0,83,l.pivot[1]-y);
      [x,y]=rotate(x,y,l.pivot,radians(s.ears[l.side<0?0:1]*weight));[x,y]=this.head(x,y,s,'ear');
    }else if(l.kind==='leg'){
      [x,y]=deformLeg(l,x,y,s);
    }else if(l.kind==='tail'){
      [x,y]=deformCreature(l,x,y,s);
    }else if(l.kind==='hair-lock'){
      // Opaque roots follow the same back-of-skull transform as the head.
      // The lower lengths retain their independent delayed chain motion.
      const follow=1-smooth(200,510,restY);
      const root=follow>0?this.headSurface.projectHairRoot(restX,restY,s,l.rootBindings?.[vertexIndex]):[restX,restY];
      const hair=this.hairRig.delta(l.name,vertexIndex);
      x=restX+(root[0]-restX)*follow+hair[0];
      y=restY+(root[1]-restY)*follow+hair[1];
    }else if(l.kind==='hair'){
      const follow=1-smooth(245,480,y),head=this.head(x,y,s,'hair');x+=(head[0]-x)*follow;y+=(head[1]-y)*follow;
      const lane=clamp((restX-200)/680*4,0,4),c=Math.min(3,Math.floor(lane)),mix=lane-c;
      const level=clamp((restY-210)/580*2,0,2),n=Math.min(1,Math.floor(level)),f=level-n;
      const sample=k=>{const chain=s.hairChains?.[k]??[0,0,0];return chain[n]*(1-f)+chain[n+1]*f;};
      const swing=sample(c)*(1-mix)+sample(c+1)*mix,tip=smooth(210,800,restY);
      x+=swing*tip;y+=(Math.sin(t*.87-lane*.8-restY*.004)*1.8*(s.activity??1)+Math.abs(swing)*.045)*tip;
    }else if(l.kind==='cloth'){
      [x,y]=deformPanel(x,y,l,s);
    }else if(l.kind==='body'){
      // Sag along the belt's curved chain and a small response in the bow tails.
      const chain=(1-smooth(18,48,Math.abs(restY-(594-(restX-395)*.4))))*smooth(385,410,restX)*(1-smooth(570,600,restX));
      y+=(s.chainSag??0)*chain;

    }
    [x,y]=deformSecondary(l,x,y,s);
    [x,y]=deformNeck(l,x,y);
    [x,y]=deformTorso(l,x,y,s,restX,l.kind==='tail'&&s.tailStyle==='back'?y:restY);
    const rootY=l.kind==='arm-rest'?347:restY;const bodyWeight=l.kind==='leg'?1-smooth(708,1170,restY):1;
    [x,y]=rotate(x,y,[542,700],radians(s.bodyRoll*bodyWeight));
    x+=(s.pelvisX??0)*bodyWeight+(s.shoulderX??0)*(1-smooth(320,700,rootY));
    y+=(s.pelvisY??0)*bodyWeight+s.breath*(1-smooth(500,750,rootY))-(s.shoulderLift??0)*(1-smooth(350,620,rootY));
    if(details&&l.kind==='cloth')return this.clothDetails.deform(l,restX,restY,[x,y],s,(a,b)=>this.deform(l,a,b,s,-1,false));
    return[x,y];
  }
  render(headCanvas,view,state){
    if(this.disposed)return;const g=this.gl;g.viewport(0,0,this.canvas.width,this.canvas.height);g.clear(g.COLOR_BUFFER_BIT);g.useProgram(this.program);g.uniform4f(this.camera,...view);g.uniform1f(this.opacity,1);g.activeTexture(g.TEXTURE0);this.headSurface.preparePose?.(state);this.clothDetails.reset();
    for(const l of this.parts){
      if(l.kind==='head'){this.headSurface.render(view,state);continue;}
      g.uniform1f(this.neckSkinCut,l.name==='body'||l.name==='neck-front'?1:0);g.uniform4f(this.sourceRect,l.x,l.y,l.width,l.height);
      for(let i=0;i<l.rest.length;i+=2){const p=this.deform(l,l.rest[i],l.rest[i+1],state,i/2);l.positions[i]=p[0];l.positions[i+1]=p[1];}
      g.bindVertexArray(l.vao);g.bindBuffer(g.ARRAY_BUFFER,l.position);g.bufferSubData(g.ARRAY_BUFFER,0,l.positions);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,l.texture);g.drawElements(g.TRIANGLES,l.count,g.UNSIGNED_INT,0);
    }
    this.armRenderer.render(view,state);
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.headSurface?.dispose();this.armRenderer?.dispose();this.clothDetails.dispose();const g=this.gl;for(const l of this.parts){g.deleteBuffer(l.position);g.deleteBuffer(l.uvBuffer);g.deleteBuffer(l.index);g.deleteTexture(l.texture);g.deleteVertexArray(l.vao);l.rootBindings=null;}this.headSurface.nativePixels=null;g.deleteProgram(this.program);}
}
