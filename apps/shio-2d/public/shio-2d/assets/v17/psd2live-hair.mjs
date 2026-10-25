// The rig and all pendulums are authored and exported by PSD2Live MCP.
// Uses the MIT licensed p2lrt C ABI; does not author or render the face.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class Psd2LiveHair {
 static async load(base=new URL('./psd2live/',import.meta.url).href) {
  const get=async path=>{const r=await fetch(base+path);if(!r.ok)throw Error('PSD2Live hair resource '+r.status);return r.arrayBuffer();};
  const [wasm,bytes,metadata]=await Promise.all([get('p2l_runtime.wasm'),get('shio-hair.p2lrt'),fetch(base+'mapping.json').then(r=>{if(!r.ok)throw Error('PSD2Live hair mapping missing');return r.json();})]);
  const {instance}=await WebAssembly.instantiate(wasm,{});return new Psd2LiveHair(instance.exports,new Uint8Array(bytes),metadata);
 }
 constructor(rt,bytes,metadata){
  this.rt=rt;this.meshes=new Map();this.steps=0;this.elapsed=0;this.disposed=false;const at=rt.p2l_alloc(bytes.length),err=rt.p2l_alloc(512);
  try{new Uint8Array(rt.memory.buffer,at,bytes.length).set(bytes);this.rig=rt.p2l_rig_load(at,bytes.length,err,512);if(!this.rig)throw Error(this.string(err));}finally{rt.p2l_dealloc(at,bytes.length);rt.p2l_dealloc(err,512);}
  try{
   rt.p2l_behaviors(this.rig,0);this.parameters=Array.from({length:rt.p2l_parameter_count(this.rig)},(_,i)=>this.string(rt.p2l_parameter_id(this.rig,i)));this.parameterIndices=new Map(this.parameters.map((id,i)=>[id,i]));rt.p2l_update(this.rig,0);
   const meshIndices=new Map(Array.from({length:rt.p2l_mesh_count(this.rig)},(_,i)=>[this.string(rt.p2l_mesh_id(this.rig,i)),i]));
   const countAt=rt.p2l_alloc(4);
   try{for(const [name,id] of Object.entries(metadata.meshes)){
    const index=meshIndices.get(id);if(index===undefined)throw Error('PSD2Live hair mesh missing: '+id);const count=rt.p2l_mesh_vertex_count(this.rig,index),pointer=rt.p2l_mesh_indices(this.rig,index,countAt),n=new Uint32Array(rt.memory.buffer,countAt,1)[0];
    this.meshes.set(name,{index,count,rest:new Float32Array(new Float32Array(rt.memory.buffer,rt.p2l_mesh_vertices(this.rig,index),count*2)),indices:new Uint32Array(new Uint32Array(rt.memory.buffer,pointer,n)),current:null});
   }}finally{rt.p2l_dealloc(countAt,4);}
   this.frontIndices=Array.from({length:7},(_,i)=>Array.from({length:3},(_,j)=>this.parameterIndices.get('ParamShioFront'+i+j)));
   if(this.frontIndices.flat().some(i=>i===undefined))throw Error('PSD2Live front strand parameters missing');
  }catch(error){this.dispose();throw error;}
 }
 string(pointer){const a=new Uint8Array(this.rt.memory.buffer,pointer),end=a.indexOf(0);return new TextDecoder().decode(a.subarray(0,end));}
 set(id,value){const index=this.parameterIndices.get(id);if(index!==undefined)this.rt.p2l_set_parameter(this.rig,index,value);}
 mesh(name){return this.meshes.get(name);}
 step(p,dt){
  if(this.disposed)return;const h=clamp(dt,0,.05),activity=p.activity??0,time=p.time??0;
  this.set('ParamAngleX',clamp(p.yaw??0,-60,60));this.set('ParamAngleY',clamp(p.pitch??0,-30,30));this.set('ParamAngleZ',clamp(p.roll??0,-20,20));this.set('ParamBodyAngleX',clamp(p.torsoYaw??0,-10,10));this.set('ParamBodyAngleY',clamp(p.torsoPitch??0,-4,4));this.set('ParamBodyAngleZ',clamp(p.bodyRoll??0,-10,10));
  const breeze=(p.wind??0)*(.66*Math.sin(time*1.15)+.34*Math.sin(time*2.6+.6))+.10*activity*Math.sin(time*.83)+.04*activity*Math.sin(time*1.71);
  this.set('ParamShioWind',clamp(breeze,-1,1));this.rt.p2l_update(this.rig,h);this.steps++;this.elapsed+=h;
  const values=new Float32Array(this.rt.memory.buffer,this.rt.p2l_parameter_current(this.rig),this.parameters.length);p.frontHair??=Array.from({length:7},()=>[0,0,0]);
  for(let i=0;i<7;i++)for(let j=0;j<3;j++){const limit=i<3?2.2:4.0;p.frontHair[i][j]=limit*Math.tanh(values[this.frontIndices[i][j]]*1.8);}
  for(const mesh of this.meshes.values())mesh.current=new Float32Array(this.rt.memory.buffer,this.rt.p2l_mesh_vertices(this.rig,mesh.index),mesh.count*2);
 }
 delta(name,vertex){const mesh=this.meshes.get(name);if(!mesh||!mesh.current)return[0,0];const k=vertex*2;return[mesh.current[k]-mesh.rest[k],mesh.current[k+1]-mesh.rest[k+1]];}
 dispose(){if(this.disposed)return;this.disposed=true;if(this.rig)this.rt.p2l_rig_free(this.rig);this.rig=0;this.meshes.clear();this.parameters=[];this.frontIndices=[];}
}
