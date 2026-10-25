import {ARM_POSES,armReaction,updateArmMotion} from './assets/v22/arm-transitions-v22.mjs';
export {ARM_POSES};
import {Psd2LiveHair} from './assets/v17/psd2live-hair.mjs';
import {updateHeadMotion} from './assets/v17/head-motion-v17.mjs';
import {bodyMotionCue,updateBodyCoordination,ORBIT_DURATION,LEG_FLOW_DURATION,applyLegFlow} from './assets/v22/body-flow-v22.mjs';
import {updateBreathing,measureKinetics} from './assets/v16/kinetics-v16.mjs';
import {updateTextiles} from './assets/v17/textiles-v17.mjs';
import {updateLegRig,constrainSupport} from './assets/v22/leg-rig-v22.mjs';
import {updateTorsoMotion,TORSO_LIMITS,turnTrack} from './assets/v16/torso-motion-v16.mjs';
import {updateSecondaryMotion} from './assets/v22/secondary-motion-v22.mjs';
import {updateCreatureMotion} from './assets/v22/creature-motion-v22.mjs';
import {ShioRenderer} from './rig-renderer.mjs';
import {resolveRenderSize,exportFourK} from './assets/v8/render-quality.mjs';
import {updateGarmentMotion} from './assets/v16/garment-motion-v16.mjs';
import {referenceReaction,mergeReaction} from './assets/v16/reaction-motion-v16.mjs';
const labels=['Спокойствие','Радость','Грусть','Сердитость','Удивление','Смущение','Усмешка','Сонливость','Восторг','Тревога','Недоумение','Гордость','Обида','Слёзы','Смех','Нежность','Ошеломление'];
const names=['neutral','happy','sad','angry','surprised','shy','amused','sleepy','excited','worried','confused','proud','pouting','crying','laughing','loving','dazed'];
const icons=['◌','⌣','⌢','⋀','○','⁄','⌁','☾','✧','∿','?','♢','﹏','⋮','⌒','♡','◎'];
export const EXPRESSIONS=Object.fromEntries(names.map((n,i)=>[n,{label:labels[i],icon:icons[i]}]));
export const GESTURES={nod:'Кивок',tilt:'Наклон',shake:'Отрицание',wink:'Подмигнуть',ears:'Движение ушей',earLeft:'Свернуть левое ухо',earRight:'Свернуть правое ухо',tail:'Взмах хвоста',sway:'Перенос веса',step:'Лёгкий шаг',curtsy:'Реверанс',breeze:'Ветер в волосах',lookaround:'Осмотреться',tailcurl:'Свернуть хвост',turnbody:'Поворот корпуса',balance:'Смена опоры',breathe:'Глубокий вдох',orbit:'Пластика тела и ног',legflow:'Пластика ног'};
export const GESTURE_DURATIONS={earLeft:3.8,earRight:3.8,legflow:LEG_FLOW_DURATION,orbit:ORBIT_DURATION,balance:9.2,breathe:9.4,turnbody:12,sway:6.4,step:5.4,curtsy:4.8,nod:3.2,tilt:3.2,shake:3.1,wink:1.65,ears:3.3,tail:3.8,breeze:7,lookaround:10.8,tailcurl:5.5};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),finite=x=>typeof x==='number'&&Number.isFinite(x);
const smooth=(a,b,x)=>{const u=clamp((x-a)/(b-a),0,1);return u*u*(3-2*u);};
export class ShioPuppet{
  constructor(canvas){this.canvas=canvas;this.images={};this.layers={};this.features={};this.emotion='neutral';this.intensity=.8;this.weights={neutral:1};this.gaze={x:0,y:0};this.gazeTarget={x:0,y:0};this.mouth=0;this.mouthTarget=0;this.viseme='a';this.visemeWeights={a:1,e:0,o:0,u:0,laugh:0,grin:0};this.motion=true;this.liveliness=1;this.time=0;this.speechTime=0;this.gesture=null;this.facialGesture=null;this.armPose='waist';this.tailStyle='side';this.nextBlink=3;this.blinkStart=-99;this.blinkGuardUntil=0;this.cues=[];this.raf=0;this.disposed=false;this.state='idle';this.view='full';this.onFrame=null;this.manualHead=null;this.manualTorso=null;this.headStyle='rigged';this.renderQuality='4k';this.exporting=false;this.springs={};this.pose={yaw:0,pitch:0,roll:0,ears:[0,0],tail:0,hair:0,cloth:0,bodyRoll:0,torsoYaw:0,torsoPitch:0,breath:0,time:0};}
  async load(url=new URL('./assets/v22/model.json',import.meta.url).href){
    const r=await fetch(url);if(!r.ok)throw Error('Не удалось загрузить модель Шио');this.model=await r.json();const baseURL=new URL(url,location.href);
    await Promise.all([...this.model.layers,...(this.model.resources??[]),...this.model.features,...(this.model.head.semantic?.views??[]),...(this.model.head.resources??[]),...this.model.features.filter(l=>l.ink).map(l=>({name:'ink-'+l.name,file:l.ink}))].map(async l=>{this.layers[l.name]=l;if(this.model.features.includes(l))this.features[l.name]=l;const img=new Image();img.src=new URL(l.file,baseURL).href;await img.decode();if(!this.disposed)this.images[l.name]=img;}));
    if(this.disposed)return;if(this.model.head.flowFile){const flow=await fetch(new URL(this.model.head.flowFile,baseURL));if(!flow.ok)throw Error('Не удалось загрузить сетку головы');this.model.head.flowData=new Float32Array(await flow.arrayBuffer());}this.headLayer=this.model.layers.find(l=>l.kind==='head');this.art=document.createElement('canvas');this.art.width=this.headLayer.width;this.art.height=this.headLayer.height;this.context=this.art.getContext('2d');this.hairRig=await Psd2LiveHair.load();if(this.disposed){this.hairRig.dispose();return;}this.mesh=new ShioRenderer(this.canvas,this.model,this.images,this.hairRig);this.resize=()=>{if(this.disposed||this.exporting)return;const r=this.canvas.parentElement.getBoundingClientRect(),g=this.mesh.gl,maxDimension=Math.min(g.getParameter(g.MAX_TEXTURE_SIZE),g.getParameter(g.MAX_RENDERBUFFER_SIZE),...g.getParameter(g.MAX_VIEWPORT_DIMS));this.renderSize=resolveRenderSize({width:r.width,height:r.height,quality:this.renderQuality,devicePixelRatio:devicePixelRatio||1,maxDimension});if(this.canvas.width!==this.renderSize.width||this.canvas.height!==this.renderSize.height){this.canvas.width=this.renderSize.width;this.canvas.height=this.renderSize.height;}};this.resizeObserver=new ResizeObserver(this.resize);this.resizeObserver.observe(this.canvas.parentElement);this.resize();this.last=performance.now();this.raf=requestAnimationFrame(this.tick);return this;
  }
  setEmotion(n,i=this.intensity){if(!Object.hasOwn(EXPRESSIONS,n)||!finite(i))return false;this.emotion=n;this.intensity=clamp(i,0,1);return true;}
  setMouth(o,v='a'){if(!finite(o)||!['a','e','o','u','laugh','grin'].includes(v))return false;this.mouthTarget=clamp(o,0,1);this.viseme=v;return true;}
  setGaze(x,y){if(!finite(x)||!finite(y))return false;this.gazeTarget={x:clamp(x,-1,1),y:clamp(y,-1,1)};return true;}
  headLimits(){return this.model?.head??{yawLimit:60,pitchLimit:30,rollLimit:20};}
  setHeadStyle(style){if(!['rigged','reference','turnaround'].includes(style))return false;this.headStyle='rigged';return true;}
  setRenderQuality(quality){if(!['4k','auto'].includes(quality))return false;this.renderQuality=quality;this.resize?.();return true;}
  async exportPNG(orientation='portrait'){if(!this.mesh||this.disposed)throw Error('Модель ещё не готова');if(this.exporting)throw Error('Сохранение уже выполняется');this.exporting=true;try{return await exportFourK({canvas:this.canvas,camera:this.model.camera[this.view],orientation,draw:camera=>{if(!this.disposed)this.mesh.render(this.art,camera,this.pose);}});}finally{this.exporting=false;if(!this.disposed){this.resize();this.render();}}}
  setHead(yaw,pitch,roll=0){if(![yaw,pitch,roll].every(finite))return false;const h=this.headLimits();this.manualHead={yaw:clamp(yaw,-h.yawLimit,h.yawLimit),pitch:clamp(pitch,-h.pitchLimit,h.pitchLimit),roll:clamp(roll,-h.rollLimit,h.rollLimit)};return true;}
  setTorso(yaw,pitch=0){if(![yaw,pitch].every(finite))return false;this.manualTorso={yaw:clamp(yaw,-TORSO_LIMITS.yaw,TORSO_LIMITS.yaw),pitch:clamp(pitch,-TORSO_LIMITS.pitch,TORSO_LIMITS.pitch)};return true;}
  clearTorso(){this.manualTorso=null;}
  clearHead(){this.manualHead=null;}
  setView(v){if(!this.model||!Object.hasOwn(this.model.camera,v))return false;this.view=v;return true;}
  setLiveliness(v){if(!finite(v))return false;this.liveliness=clamp(v,0,1.5);return true;}
  setState(v){if(!['idle','listening','thinking','speaking'].includes(v))return false;this.state=v;return true;}
  setArmPose(name){if(!Object.hasOwn(ARM_POSES,name))return false;this.armPose=name;return true;}
  setTailStyle(style){if(!['side','back'].includes(style))return false;this.tailStyle=style;return true;}
  react(n){if(!Object.hasOwn(GESTURES,n))return false;if(n==='wink'){this.facialGesture={name:n,start:this.time};this.blinkGuardUntil=Math.max(this.blinkGuardUntil,this.time+GESTURE_DURATIONS.wink+.75);}else this.gesture={name:n,start:this.time};return true;}
  setVisemes(cues){if(!Array.isArray(cues)||cues.length>2000||cues.some(c=>!c||!finite(c.time)||c.time<0||!finite(c.open)||c.open<0||c.open>1||!['a','e','o','u','laugh','grin'].includes(c.viseme||'a')))return false;this.cues=cues.map(c=>({...c,time:c.time+this.speechTime})).sort((a,b)=>a.time-b.time);if(!cues.length)this.setMouth(0);return true;}
  stop(){this.cues=[];this.setMouth(0);this.gesture=null;this.facialGesture=null;this.setState('idle');this.clearHead();this.clearTorso();}
  command(c){if(!c||typeof c!=='object'||Array.isArray(c))return false;switch(c.type){case'tailStyle':return this.setTailStyle(c.style);case'armPose':return this.setArmPose(c.pose);case'emotion':return this.setEmotion(c.emotion,c.intensity??this.intensity);case'mouth':return this.setMouth(c.open,c.viseme??'a');case'gaze':return this.setGaze(c.x,c.y);case'head':return this.setHead(c.yaw,c.pitch,c.roll??0);case'torso':return this.setTorso(c.yaw,c.pitch??0);case'torsoAuto':this.clearTorso();return true;case'headAuto':this.clearHead();return true;case'headStyle':return this.setHeadStyle(c.style);case'quality':return this.setRenderQuality(c.quality);case'liveliness':return this.setLiveliness(c.value);case'view':return this.setView(c.view);case'gesture':return this.react(c.gesture);case'state':return this.setState(c.state);case'visemes':return this.setVisemes(c.cues);case'stop':this.stop();return true;default:return false;}}
  spring(key,target,dt,k=55,d=15){const s=this.springs[key]??={value:0,velocity:0};const steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;for(let i=0;i<steps;i++){s.velocity+=(target-s.value)*k*h;s.velocity*=Math.exp(-d*h);s.value+=s.velocity*h;}if(Math.abs(target-s.value)<1e-8&&Math.abs(s.velocity)<1e-8){s.value=target;s.velocity=0;}return s.value;}
  patch(name,alpha=1,sx=1,sy=1,half=null){const l=this.features[name];if(!l||alpha<.001)return;const c=this.context,h=this.headLayer;c.save();c.translate(-h.x,-h.y);if(half!==null){c.beginPath();c.rect(half?543:470,120,half?90:73,90);c.clip();}c.globalAlpha=alpha;c.translate(l.x+l.width/2,l.y+l.height/2);c.scale(sx,sy);c.drawImage(this.images[name],-l.width/2,-l.height/2,l.width,l.height);c.restore();}
  composeFace(){const c=this.context;c.clearRect(0,0,this.art.width,this.art.height);c.drawImage(this.images.head,0,0);
    for(const [n,w]of Object.entries(this.weights))if(n!=='neutral')this.patch('eyes-'+n,w);
    const bt=this.time-this.blinkStart,blink=this.externalBlink??(bt>=0&&bt<.2?Math.sin(bt/.2*Math.PI)**2:0);
    this.patch('eyes-closed',blink,1,1,0);this.patch('eyes-closed',Math.max(blink,this.wink||0),1,1,1);
    const mix=clamp(this.mouth*8,0,1);for(const [n,w]of Object.entries(this.weights))if(n!=='neutral')this.patch('mouth-'+n,w*(1-mix));
    const mouth={a:['a',1,1],e:['e',1,1],o:['o',1,1],u:['o',.8,.85],laugh:['laughing',1,1],grin:['e',1,.5]}[this.viseme];if(mix>.001)this.patch('mouth-'+mouth[0],mix,mouth[1],mouth[2]*(.3+.7*this.mouth));
  }
  updatePose(dt){
    const t=this.time,activity=this.motion?this.liveliness:0,w=this.weights,p=this.pose;
    const bodyCue=bodyMotionCue(t,this.gesture,activity);
    if(this.facialGesture&&t-this.facialGesture.start>=GESTURE_DURATIONS[this.facialGesture.name])this.facialGesture=null;
    const mainCue=this.gesture?referenceReaction(this.gesture.name,t-this.gesture.start,GESTURE_DURATIONS[this.gesture.name]??1):referenceReaction('',-1,1);
    const faceCue=this.facialGesture?referenceReaction(this.facialGesture.name,t-this.facialGesture.start,GESTURE_DURATIONS[this.facialGesture.name]):referenceReaction('',-1,1);
    const reaction=mergeReaction(mergeReaction(mainCue,faceCue),armReaction(this,referenceReaction('',-1,1),dt));p.reactionCue=reaction;
    const exc=(w.excited||0)+(w.laughing||0)*.6+(w.happy||0)*.4,sad=(w.sad||0)+(w.crying||0),shy=w.shy||0;
    let yaw=this.manualHead?.yaw??this.gaze.x*24,pitch=this.manualHead?.pitch??this.gaze.y*11,roll=this.manualHead?.roll??(shy*3-(w.amused||0)*3);
    // Gaze settles before the slower neck; breaths and weight changes have
    // different periods, so the entire drawing never oscillates in unison.
    const idleShift=(Math.sin(t*.48)+Math.sin(t*.21+.8)*.27)*activity;
    if(!this.manualHead){yaw+=(Math.sin(t*.37)*1.2+idleShift*.65)*activity;pitch+=Math.sin(t*.57)*.7*activity;if(this.state==='thinking')yaw+=5;if(this.state==='listening')roll-=2;}
    let earImpulse=0,tailImpulse=0,shift=0,lower=0,wind=0;
    const feet=[{x:0,lift:0,roll:0,knee:0},{x:0,lift:0,roll:0,knee:0}];
    this.wink=reaction.wink;const g=this.gesture;
    if(g){const a=t-g.start,duration=GESTURE_DURATIONS[g.name]??2.7;
      if(a>=duration)this.gesture=null;
      else{const u=a/duration,e=smooth(0,.22,u)*(1-smooth(.72,1,u));
        if(g.name==='nod')pitch+=Math.sin(a*6)*9*e;if(g.name==='shake')yaw+=Math.sin(a*4.4)*12*e;if(g.name==='tilt')roll+=11*e;
        if(g.name==='wink')this.wink=Math.max(this.wink,referenceReaction('wink',a,duration).wink);
        if(g.name==='ears')earImpulse=(Math.exp(-(((a-.85)/.23)**2))*4-Math.exp(-(((a-1.65)/.29)**2))*3)*e;if(g.name==='tail')tailImpulse=Math.sin(a*2.6)*6*e;
        if(g.name==='sway'){shift=Math.sin(a*1.7)*18*e;lower=(1-Math.cos(a*3.4))*2*e;roll-=shift*.12;}
        if(g.name==='step'){
          // Each foot lifts and returns before the other leaves the floor.
          const left=Math.sin(Math.PI*clamp((u-.18)/.24,0,1))**2,right=Math.sin(Math.PI*clamp((u-.52)/.24,0,1))**2;
          feet[0]={x:-26*left,lift:34*left,roll:-3.5*left,knee:-22*left};feet[1]={x:26*right,lift:34*right,roll:3.5*right,knee:22*right};
          shift=(left-right)*11;lower=-2*(left+right);
        }
        if(g.name==='curtsy'){lower=16*e;shift=-3*e;feet[0].knee=-8*e;feet[1].knee=8*e;pitch+=8*e;}
        if(g.name==='turnbody'&&!this.manualHead){yaw+=turnTrack(a)*2.4;pitch+=Math.sin(a*.6)*2*e;}
        if(g.name==='lookaround'){yaw=Math.sin(a*.68)*60*e;pitch=Math.sin(a*.53)*30*e;}
        if(g.name==='balance'){const wave=smooth(0,.16,u)*(1-smooth(.82,1,u));shift=Math.sin((u-.08)*Math.PI*2)*15*wave;lower=(1-Math.cos(u*Math.PI*4))*.7*wave;roll-=shift*.08;}
        if(g.name==='breathe'&&!this.manualHead)pitch-=smooth(0,.3,u)*(1-smooth(.5,.95,u))*2;
        if(g.name==='breeze')wind=(Math.sin(a*.9)*.6+1)*e;
      }
    }
    shift+=bodyCue.x;lower+=bodyCue.y;
    if(!this.manualHead){yaw+=bodyCue.headYaw;pitch+=bodyCue.headPitch;roll+=bodyCue.headRoll;}
    if(!this.manualHead){yaw*=1-reaction.attend*.70;pitch=pitch*(1-reaction.attend*.5)+reaction.pitch;roll+=reaction.roll;}
    const h=this.headLimits();p.shoulderLift=this.spring('v9-shoulder-lift',reaction.shoulderLift,dt,65,17);p.headStyle=this.headStyle;p.time=t;p.activity=activity;p.wind=wind;
    updateHeadMotion(this,p,{yaw,pitch,roll},dt);
    p.pelvisX=this.spring('pelvisX',idleShift*(1-bodyCue.orbit*.85)*(6+exc*2)+shift,dt,38,12);p.pelvisY=this.spring('pelvisY',lower+Math.sin(t*.96)*.6*activity,dt,42,12);
    p.bodyRoll=this.spring('bodyRoll',-idleShift*.38+p.roll*.045-shift*.035-(p.torsoYaw??0)*.045,dt,34,11);
    p.breath=(Math.sin(t*1.38)*.9+Math.sin(t*2.76)*.15)*activity;p.shoulderX=-idleShift*1.7*(1-bodyCue.orbit*.85);
    updateBreathing(this,p,dt,GESTURE_DURATIONS[this.gesture?.name]??1);
    updateBodyCoordination(this,p,dt,bodyCue);
    updateTorsoMotion(this,dt,GESTURE_DURATIONS[this.gesture?.name]??1);
    applyLegFlow(bodyCue,feet);p.legFlow=bodyCue.legFlow??null;
    p.legs??=[{},{}];
    for(let side=0;side<2;side++){
      const l=p.legs[side],f=feet[side],sign=side?1:-1;
      l.knee=this.spring('knee'+side,f.knee+sign*(Math.sin(t*.48+side*.8)+1)*2*activity,dt,46,13);
      l.x=this.spring('footX'+side,f.x,dt,70,17);l.lift=this.spring('footLift'+side,f.lift,dt,85,18);l.roll=this.spring('footRoll'+side,f.roll,dt,65,17);l.contact=l.lift<.6;
    }
    constrainSupport(p);measureKinetics(this,p,dt);updateLegRig(this,p);updateTextiles(this,p,dt);
    const neckVelocity=clamp(this.springs.yaw.velocity,-80,80),rollVelocity=clamp(this.springs.roll.velocity,-60,60),rootVelocity=clamp(this.springs.pelvisX.velocity,-45,45);
    const twitch=Math.exp(-(((t%8.7-1.5)/.14)**2))*3*activity;
    p.ears[0]=this.spring('earL',(-sad*10-shy*4+exc*4+Math.sin(t*1.05)*1.5)*activity+earImpulse+twitch-neckVelocity*.025,dt,95,13);
    p.ears[1]=this.spring('earR',(sad*10+shy*4-exc*4+Math.sin(t*.91+1)*1.4)*activity-earImpulse*.8-twitch*.6-neckVelocity*.02,dt,90,13);
    p.tail=this.spring('tail',(Math.sin(t*(.83+exc*.55))*(6+exc*7)-sad*4)*activity+tailImpulse-rootVelocity*.11,dt,29,6.5);
    this.hairRig?.step(p,dt);
    p.hair=p.frontHair?.[0]?.[2]??0;p.clothPanels??=[[0,0,0],[0,0,0]];
    for(let side=0;side<2;side++)for(let n=0;n<3;n++){
      const incoming=n?p.clothPanels[side][n-1]*.9:-rootVelocity*.16-p.bodyRoll*2-(p.torsoVelocity??0)*.10;
      const breeze=Math.sin(t*.87+side*1.5-n*.9)*(.7+n*.4)*activity;
      p.clothPanels[side][n]=this.spring('cloth'+side+n,incoming+breeze+wind*(3+n*1.8),dt,30-n*8,8-n*1.5);
    }
    p.cloth=p.clothPanels[0][2];p.bell=this.spring('bell',-rootVelocity*.2-neckVelocity*.035-rollVelocity*.1-(p.torsoVelocity??0)*.07+Math.sin(t*1.7)*1.2*activity,dt,75,5.8);
    p.charms??=[0,0,0,0];for(let i=0;i<4;i++)p.charms[i]=this.spring('charm'+i,-rootVelocity*.12-(p.kinetics?.acceleration.x??0)*.013+(p.textiles?.cloth[i%2]?.velocity[6][0]??0)*.12+wind*1.4,dt,38+i*7,4.2+i*.3);
    updateGarmentMotion(this,p,dt);
    updateCreatureMotion(this,p,dt,GESTURE_DURATIONS[this.gesture?.name]??2.7);
    updateSecondaryMotion(this,p,dt);updateArmMotion(this,p,dt);
    
    const profiles={neutral:[1,0,0,0],happy:[.8,.8,-.3,.15],sad:[.65,-.5,.6,-.5],angry:[.65,-.2,-.5,1],surprised:[1.3,.05,.7,0],shy:[.75,.4,-.1,-.2],amused:[.65,.65,-.2,.2],sleepy:[.35,.1,.2,0],excited:[1.1,1,-.4,.1],worried:[.8,-.35,.6,-.5],confused:[.8,-.1,.25,-.4],proud:[.7,.55,-.3,.3],pouting:[.7,-.6,.2,.4],crying:[.45,-.5,.7,-.5],laughing:[.2,1,-.4,0],loving:[.65,.6,-.2,-.1],dazed:[.5,.3,.6,-.2]};
    let lid=0,smile=0,brow=0,tilt=0;for(const [name,weight]of Object.entries(this.weights)){const v=profiles[name]??profiles.neutral;lid+=v[0]*weight;smile+=v[1]*weight;brow+=v[2]*weight;tilt+=v[3]*weight;}
    const bt=t-this.blinkStart,blink=this.externalBlink??(bt>=0&&bt<.24?Math.sin(bt/.24*Math.PI)**2:0);
    brow+=reaction.brow;tilt+=reaction.tilt;lid+=(.90-lid)*reaction.relax;smile=smile*(1-reaction.strength)+reaction.smile;
    const cueOpen=this.spring('reactionOpen',reaction.open,dt,82,19),cueBlush=this.spring('reactionBlush',reaction.blush,dt,46,15);
    const cueFocus=this.spring('reactionFocus',reaction.focus,dt,65,17),cueSparkle=this.spring('reactionSparkle',reaction.sparkle,dt,55,16),attend=this.spring('reactionAttention',reaction.attend,dt,62,17);
    p.face={lidL:clamp(this.spring('lid',lid,dt,70,17)*(1-blink),.06,1.35),lidR:clamp((this.springs.lid?.value??1)*(1-Math.max(blink,this.wink??0)),.06,1.35),smile:this.spring('smile',smile,dt,60,16),brow:this.spring('brow',brow,dt,55,15),tilt:this.spring('browTilt',tilt,dt,55,15),gazeX:this.gaze.x*(1-attend*.8),gazeY:this.gaze.y*(1-attend*.8)+reaction.gazeY,blush:clamp((w.shy??0)+(w.loving??0)*.5+cueBlush,0,1),tears:w.crying??0,round:(w.surprised??0)*(1-reaction.strength*.7),open:Math.max((w.laughing??0)*.7+(w.surprised??0)*.28+(w.excited??0)*.3,cueOpen),sparkle:clamp((w.excited??0)*.30+(w.loving??0)*.15+cueSparkle,0,1),focus:cueFocus};p.mouth=this.mouth;p.viseme=this.viseme;p.visemeWeights=this.visemeWeights;
    p.chainSag=this.spring('chainSag',Math.sin(t*1.4)*1.4*activity+Math.abs(rootVelocity)*.04,dt,60,7);
  }
  camera(){const [x,y,w,h]=this.model.camera[this.view],aspect=this.canvas.width/this.canvas.height;if(aspect>w/h){const width=h*aspect;return[x+(w-width)/2,y,width,h];}const height=w/aspect;return[x,this.view==='full'?y+(h-height)/2:y,w,height];}
  render(){if(!this.exporting&&this.mesh)this.mesh.render(this.art,this.camera(),this.pose);}
  tick=now=>{if(this.disposed)return;const elapsed=Math.max(0,(now-this.last)/1000),dt=clamp(elapsed,0,.1),start=this.time,end=start+dt;this.last=now;this.speechTime+=elapsed;const f=1-Math.exp(-dt*9);
    for(const n of names){const target=this.emotion==='neutral'?(n==='neutral'?1:0):(n===this.emotion?this.intensity:n==='neutral'?1-this.intensity:0);this.weights[n]=(this.weights[n]||0)+(target-(this.weights[n]||0))*f;}
    this.gaze.x+=(this.gazeTarget.x-this.gaze.x)*f;this.gaze.y+=(this.gazeTarget.y-this.gaze.y)*f;
    while(this.cues.length&&this.cues[0].time<=this.speechTime){const c=this.cues.shift();this.setMouth(c.open,c.viseme||'a');}
    this.mouth+=(this.mouthTarget-this.mouth)*(1-Math.exp(-dt*22));
    for(const key of Object.keys(this.visemeWeights))this.visemeWeights[key]+=((key===this.viseme?1:0)-this.visemeWeights[key])*(1-Math.exp(-dt*16));
    this.time=end;if(this.externalBlink===undefined&&this.motion&&this.time>=this.nextBlink&&this.time>=this.blinkGuardUntil&&this.wink<.025){this.blinkStart=this.time;this.nextBlink=this.time+3+Math.random()*3.5;}this.onFrame?.(this);
    // Every chain sees the same bounded simulation step. Audio retains wall time.
    const steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;for(let i=0;i<steps;i++){this.time=start+(i+1)*h;this.updatePose(h);}this.time=end;
    this.render();this.raf=requestAnimationFrame(this.tick);
  };
  dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.raf);this.resizeObserver?.disconnect();this.mesh?.dispose();this.hairRig?.dispose();for(const key of Object.keys(this.images))delete this.images[key];this.images={};if(this.art){this.art.width=this.art.height=1;}this.cues=[];this.onFrame=null;}
}
