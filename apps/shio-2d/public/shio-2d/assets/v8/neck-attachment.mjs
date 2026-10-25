// Keep the restored torso artwork's collar below the unchanged approved chin.
// The body plate and its foreground collar crop use the same continuous field.
// Call after local jewellery deformations and before the global body transform.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const u=clamp((v-a)/(b-a),0,1);return u*u*(3-2*u);};
export function neckOffset(x,y){
  const center=1-smooth(52,74,Math.abs(x-542));
  return 18*center*smooth(214,230,y)*(1-smooth(288,325,y));
}
export function neckTaper(x,y){
  const band=smooth(210,214,y)*(1-smooth(222,230,y));
  const width=1-smooth(24,42,Math.abs(x-538));
  return(4+(x-538)*.12)*band*width;
}
export function deformNeck(layer,x,y){
  if(layer?.name!=='body'&&layer?.name!=='neck-front')return[x,y];
  return[x+neckTaper(x,y),y+neckOffset(x,y)];
}

