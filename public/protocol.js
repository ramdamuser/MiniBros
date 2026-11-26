// Versioned array snapshots. Field names travel only in keyframes; numbers retain
// full JS precision. Nested combat state is transmitted intact, never quantized.
export class SnapshotEncoder {
 constructor(){this.revision=0;this.previous=null;this.schema='';}
 encode(room,tick){
  const {game,...meta}=room;
  const keys=game?Object.keys(game).filter(k=>k!=='players'):[];
  const fields=game?[...new Set(game.players.flatMap(p=>Object.keys(p)))]:[];
  const schema=JSON.stringify([keys,fields]);
  const values=[meta,...keys.map(k=>game[k]),...(game?.players||[]).map(p=>fields.map(k=>p[k]??null))];
  // Retain serialized values, not references to the mutable simulation.
  const current=values.map(v=>JSON.stringify(v));
  const reset=schema!==this.schema||!this.previous||current.length!==this.previous.length;
  const changes=[];
  for(let i=0;i<current.length;i++){
   if(!reset&&i>keys.length&&current[i]!==this.previous[i]){
    const before=JSON.parse(this.previous[i]),after=values[i],patch=[];
    for(let j=0;j<fields.length;j++)if(JSON.stringify(before[j])!==JSON.stringify(after[j]))patch.push(j,after[j]);
    changes.push([i,patch]);
   }else if(reset||current[i]!==this.previous[i])changes.push([i,values[i]]);
  }
  const base=this.revision++;
  this.previous=current;this.schema=schema;
  const full=JSON.stringify([1,this.revision,tick,keys,fields,values]);
  const delta=reset?full:JSON.stringify([0,this.revision,tick,base,changes]);
  return {revision:this.revision,base,full,delta:delta.length<full.length?delta:full};
 }
}
export class SnapshotDecoder {
 reset(){this.revision=0;this.values=null;}
 decode(data,ack){
  const [kind,revision,tick]=data;
  if(kind===1){this.keys=data[3];this.fields=data[4];this.values=data[5];}
  else {
   if(!this.values||data[3]!==this.revision)return null;
   this.values=this.values.slice();
   for(const [i,value] of data[4]){
    if(i>this.keys.length){const player=this.values[i].slice();for(let j=0;j<value.length;j+=2)player[value[j]]=value[j+1];this.values[i]=player;}
    else this.values[i]=value;
   }
  }
  this.revision=revision;
  const game=this.keys.length?{}:null;
  if(game){
   this.keys.forEach((key,i)=>game[key]=this.values[i+1]);
   game.players=this.values.slice(this.keys.length+1).map(row=>Object.fromEntries(this.fields.map((key,i)=>[key,row[i]])));
  }
  return {type:'state',...this.values[0],game,ack,tick};
 }
}
