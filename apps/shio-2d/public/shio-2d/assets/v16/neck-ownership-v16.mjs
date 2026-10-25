const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const u=clamp((x-a)/(b-a),0,1);return u*u*(3-2*u);};
// The neck opening belongs to the anatomical neck width, never a wide vertical
// screen-space stripe. White side locks outside this domain remain opaque.
export function headNeckOwnership(view,point){
 const W=view.pixelWidth,H=view.pixelHeight,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const c=canvas.getContext('2d'),mask=c.createImageData(W,H),sx=view.scaleX,sy=view.scaleY,[wx,wy,ox,oy]=view.transform;
 const chin=point('chin',[view.width*.5,view.height*.7]),jl=point('jawL',chin),jr=point('jawR',chin),nl=point('neckL',[chin[0]-21,chin[1]+10]),nr=point('neckR',[chin[0]+21,chin[1]+10]),center=(nl[0]+nr[0])*.5,half=Math.abs(nr[0]-nl[0])*.5;let pixels=0;
 const starts=new Float32Array(W),data=view.base.data;
 const brightness=(x,y)=>{x=clamp(Math.round(x),0,W-1);y=clamp(Math.round(y),0,H-1);const i=(y*W+x)*4;return(data[i]+data[i+1]+data[i+2])/3;};
 for(let x=0;x<W;x++){const xx=(x+.5)/sx,a=xx<=chin[0]?jl:chin,b=xx<=chin[0]?chin:jr,u=clamp((xx-a[0])/Math.max(.001,b[0]-a[0]),0,1),expected=(a[1]+(b[1]-a[1])*u)*sy;let edge=expected,best=-Infinity;
  if(xx>=jl[0]&&xx<=jr[0])for(let y=Math.max(1,Math.floor(expected-5/wy*sy));y<=Math.min(H-2,Math.ceil(expected+5/wy*sy));y++){if(data[(y*W+x)*4+3]<250)continue;const score=brightness(x,y-2)-brightness(x,y+1)-.5*Math.abs(y-expected);if(score>best){best=score;edge=y;}}
  starts[x]=Math.max(expected,edge)/sy;
 }
 const bottom=(286-oy)/wy;
 for(let y=0;y<H;y++){const yy=(y+.5)/sy,l=jl[0]+(nl[0]-jl[0])*smooth(jl[1],bottom,yy),r=jr[0]+(nr[0]-jr[0])*smooth(jr[1],bottom,yy);
  for(let x=Math.max(0,Math.floor(l*sx));x<=Math.min(W-1,Math.ceil(r*sx));x++){
   const xx=(x+.5)/sx,side=xx<=chin[0],a=side?jl:chin,b=side?chin:jr,t=clamp((xx-a[0])/Math.max(.001,b[0]-a[0]),0,1),jaw=a[1]+(b[1]-a[1])*t,edge=smooth(l,l+.8/wx,xx)*(1-smooth(r-.8/wx,r,xx)),below=smooth(1.2/wy,2.5/wy,yy-starts[x]);
   if(edge*below>0){mask.data[(y*W+x)*4+3]=Math.round(edge*below*255);pixels++;}
  }
 }
 c.putImageData(mask,0,0);return{canvas,pixels,protectedChinRow:Math.round(chin[1]*sy)};
}

