import {ACTIONS,cleanInput,FIXED_DT,MatchView} from './netcode.js';
export class Multiplayer {
 constructor({token,id,onState,onStatus,onExpired}){
  this.token=token;this.view=new MatchView(id);this.onState=onState;this.onStatus=onStatus;this.onExpired=onExpired;
  this.seq=0;this.generation=0;this.outbox=[];this.accumulator=0;this.lastHeld={};this.edges={};this.ready=false;this.closed=false;this.lastSend=0;this.rtt=0;
  this.connect();
  this.heartbeat=setInterval(()=>{if(this.ready)this.socket.send(JSON.stringify({type:'ping',at:performance.now()}));},1000);
 }
 connect(){
  if(this.closed)return;
  const socket=this.socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
  socket.onopen=()=>socket.send(JSON.stringify({type:'auth',token:this.token}));
  socket.onmessage=e=>{
   if(this.socket!==socket||this.closed)return;
   const packet=JSON.parse(e.data);
   if(packet.type==='pong'){this.rtt=Math.round(performance.now()-packet.at);return;}
   if(packet.type!=='welcome'&&packet.type!=='state')return;
   if(packet.type==='welcome'){
    this.seq=packet.ack;this.outbox=[];this.edges={};this.lastHeld={};this.accumulator=0;this.view.reset();this.ready=true;this.onStatus('connected');
   }
   if(this.generation!==packet.generation||this.view.game?.round!==packet.game?.round||this.view.game?.phase!==packet.game?.phase){
    this.outbox=[];this.edges={};this.lastHeld={};this.accumulator=0;
   }
   this.generation=packet.generation;
   this.view.receive(packet,performance.now());this.onState(packet);
  };
  socket.onclose=e=>{
   if(this.socket!==socket||this.closed)return;
   this.ready=false;this.outbox=[];this.edges={};this.view.reset();
   if(e.code===1008||e.code===4001){this.onExpired(e.reason||'Room session expired');return;}
   this.onStatus('reconnecting');this.retry=setTimeout(()=>this.connect(),1000);
  };
  socket.onerror=()=>{}; // onclose handles recovery without accumulating stale inputs.
 }
 press(action){if(this.ready&&ACTIONS.includes(action))this.edges[action]=true;}
 clear(){this.edges={};this.lastHeld={};}
 update(held,dt,now){
  if(!this.ready)return;
  for(const key of ACTIONS)if(held[key]&&!this.lastHeld[key])this.edges[key]=true;
  this.lastHeld={...held};
  let stepped=false;
  this.accumulator+=Math.min(dt,.1);
  while(this.accumulator>=FIXED_DT){
   this.accumulator-=FIXED_DT;stepped=true;
   const input=cleanInput({...held,presses:this.edges});this.edges={};
   const command={seq:++this.seq,input};this.outbox.push(command);this.view.advance(command);
  }
  // Two simulation frames per packet, independent of round-trip time.
  if(now-this.lastSend>=30&&this.outbox.length){
   if(this.socket.bufferedAmount>65536||this.outbox.length>120){this.socket.close(4000,'Slow connection');return;}
   while(this.outbox.length){const commands=this.outbox.splice(0,8);this.socket.send(JSON.stringify({type:'input',generation:this.generation,commands}));}
   this.lastSend=now;
  }
  return stepped;
 }
 render(now,dt){return this.view.render(now,dt);}
 close(){this.closed=true;this.ready=false;clearInterval(this.heartbeat);clearTimeout(this.retry);this.socket?.close();this.view.reset();}
}
