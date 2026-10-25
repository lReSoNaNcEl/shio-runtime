// The approved closed-mouth art remains untouched. Speech is a local illustration
// inside the registered lip footprint; canines stay on the upper dental arch.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export function paintFoxMouth(host,view,{open,round,wide,smile}){
 if(open<=.004)return;
 const c=view.c,center=host.point(view,'mouthCenter',[view.width/2,view.height*.66]),left=host.point(view,'mouthL',[center[0]-11,center[1]]),right=host.point(view,'mouthR',[center[0]+11,center[1]]),scale=Math.max(.25,Math.hypot(right[0]-left[0],right[1]-left[1])/22),angle=Math.atan2(right[1]-left[1],right[0]-left[0]),width=(22+wide*7-round*9+Math.max(0,smile)*3)*scale,height=open*(19+round*7)*scale,half=width/2,lift=smile*1.3*scale*smooth(.02,.12,open);
 const source=view.base.data,sx=view.scaleX,sy=view.scaleY,skinAt=(x,y)=>{const ix=Math.round(clamp(x*sx,0,view.pixelWidth-1)),iy=Math.round(clamp(y*sy,0,view.pixelHeight-1)),i=(iy*view.pixelWidth+ix)*4;return[source[i],source[i+1],source[i+2]];};
 c.save();c.translate(...center);c.rotate(angle);
 // Clone neighbouring skin along the local columns, with a soft perimeter.
 // This avoids a visible rectangular cover when a round vowel narrows the lips.
 for(let x=-17;x<17;x+=.5)for(let y=-4;y<4;y+=.5){
  const t=(y+4)/8,px=center[0]+x*scale*Math.cos(angle),py=center[1]+x*scale*Math.sin(angle),a=skinAt(px,py-7*scale),b=skinAt(px,py+7*scale),rgb=a.map((v,i)=>Math.round(v+(b[i]-v)*t)),fade=(1-smooth(13.2,17,Math.abs(x)))*(1-smooth(2.7,4,Math.abs(y)));
  c.globalAlpha=smooth(.004,.07,open)*fade;c.fillStyle='rgb('+rgb.join(',')+')';c.fillRect(x*scale,y*scale,.5*scale+.03,.5*scale+.03);
 }
 c.globalAlpha=1;
 const contour=()=>{c.beginPath();c.moveTo(-half,-lift);c.bezierCurveTo(-half*.48,-height*.3-lift*.35,half*.48,-height*.3-lift*.35,half,-lift);c.bezierCurveTo(half*.67,height*.8,-half*.67,height*.8,-half,-lift);c.closePath();};
 contour();const cavity=c.createLinearGradient(0,-height*.25,0,height*.7);cavity.addColorStop(0,'#4d2330');cavity.addColorStop(.6,'#712c3b');cavity.addColorStop(1,'#9f4a5d');c.fillStyle=cavity;c.fill();c.save();c.clip();
 const toothVisibility=(1-smooth(.48,.95,round))*smooth(.035,.14,open);
 if(toothVisibility>.001){
  c.globalAlpha=toothVisibility;
  const arch=height*.018-lift*.3;
  c.fillStyle='#f9e4dc';c.beginPath();c.moveTo(-half,-height);c.lineTo(half,-height);c.lineTo(half,arch-.2*scale);c.quadraticCurveTo(0,arch+height*.075,-half,arch-.2*scale);c.closePath();c.fill();
  // Two pointed fox canines, visible in ordinary speech as well as smiles.
  const depth=Math.min(3.5*scale,height*.52)*(1-round*.5),fw=Math.min(1.45*scale,half*.13);
  c.fillStyle='#fff3e8';
  for(const side of [-1,1]){const x=side*half*.62,y=arch+height*.018;c.beginPath();c.moveTo(x-fw,y-.8*scale);c.quadraticCurveTo(x-fw*.5,y+depth*.55,x+side*.17*scale,y+depth);c.quadraticCurveTo(x+fw*.55,y+depth*.47,x+fw,y-.8*scale);c.closePath();c.fill();c.strokeStyle='rgba(117,66,72,.3)';c.lineWidth=.18*scale;c.stroke();}
  // A restrained lower tooth edge appears only in a wide grin.
  if(wide>.35&&open>.22){c.globalAlpha=toothVisibility*smooth(.35,.75,wide)*.85;c.fillStyle='#f1d8d3';c.beginPath();c.ellipse(0,height*.70,width*.32,height*.11,0,Math.PI,Math.PI*2);c.fill();}
  c.globalAlpha=1;
 }
 if(height>2*scale){const tongue=c.createLinearGradient(0,height*.3,0,height*.82);tongue.addColorStop(0,'#bd5e76');tongue.addColorStop(1,'#e394a4');c.fillStyle=tongue;c.beginPath();c.ellipse((wide-round)*.35*scale,height*.61,width*(.30-round*.05),height*.24,0,0,Math.PI*2);c.fill();c.strokeStyle='rgba(153,66,87,.28)';c.lineWidth=.2*scale;c.beginPath();c.moveTo(0,height*.47);c.lineTo(0,height*.64);c.stroke();}
 c.restore();contour();c.lineWidth=.48*scale;c.strokeStyle='rgba(101,45,55,.7)';c.stroke();
 // A small lower-lip reflection follows jaw opening, never the upper teeth.
 c.globalAlpha=smooth(.15,.45,open)*.40;c.strokeStyle='#fff0e8';c.lineWidth=.55*scale;c.beginPath();c.moveTo(-width*.12,height*.65+scale);c.quadraticCurveTo(0,height*.71+scale,width*.12,height*.65+scale);c.stroke();c.restore();
}

