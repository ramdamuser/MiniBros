import {SnapshotDecoder} from './protocol.js';
import {ACTIONS,BUTTONS,cleanInput,FIXED_DT,INTERPOLATION_MS,MatchView} from './netcode.js';
export class Multiplayer {
 constructor({token,id,onState,onStatus,onExpired}){
  this.decoder=new SnapshotDecoder();this.token=token;this.view=new MatchView(id);this.onState=onState;this.onStatus=onStatus;this.onExpired=onExpired;
  this.seq=0;this.generation=0;this.outbox=[];this.accumulator=0;this.lastHeld={};this.edges={};this.ready=false;this.closed=false;this.lastSend=0;this.rtt=0;
  this.connect();
  this.heartbeat=setInterval(()=>{if(this.ready)this.socket.send(JSON.stringify({type:'ping',at:performance.now()}));},1000);
 }
 connect(){
  if(this.closed)return;
  this.rtt=null;this.lastPong=null;this.snapshotTimes=[];
  const socket=this.socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
  socket.onopen=()=>socket.send(JSON.stringify({type:'auth',token:this.token}));
  socket.onmessage=e=>{
   if(this.socket!==socket||this.closed)return;
   let packet=JSON.parse(e.data);
   if(Array.isArray(packet)&&packet[0]==='snapshot'){
    packet=this.decoder.decode(packet[2],packet[1]);
    if(!packet){socket.send(JSON.stringify({type:'resync'}));return;}
   }
   if(packet.type==='pong'){this.lastPong=performance.now();this.rtt=Math.round(this.lastPong-packet.at);return;}
   if(packet.type!=='welcome'&&packet.type!=='state')return;
   if(packet.type==='welcome'){
    this.decoder.reset();
    this.seq=packet.ack;this.outbox=[];this.edges={};this.lastHeld={};this.accumulator=0;this.view.reset();this.lastCommand=null;this.ready=true;this.onStatus('connected');
   }
   if(this.generation!==packet.generation||this.view.game?.round!==packet.game?.round||this.view.game?.phase!==packet.game?.phase){
    this.outbox=[];this.edges={};this.lastHeld={};this.accumulator=0;this.lastCommand=null;
   }
   this.generation=packet.generation;
   const now=performance.now();
   if(packet.type==='state'&&packet.game){
    this.snapshotTimes.push(now);
    this.snapshotTimes=this.snapshotTimes.filter(at=>now-at<=2000);
   }
   this.view.receive(packet,now);this.onState(packet);
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
  let stepped=false,urgent=false;
  this.accumulator+=Math.min(dt,.1);
  while(this.accumulator>=FIXED_DT){
   this.accumulator-=FIXED_DT;stepped=true;
   const input=cleanInput({...held,presses:this.edges});this.edges={};
   urgent ||= ACTIONS.some(key=>input.presses[key])||BUTTONS.some(key=>input[key]!==!!this.lastCommand?.[key]);
   this.lastCommand=input;
   const command={seq:++this.seq,input};this.outbox.push(command);this.view.advance(command);
  }
  // Send starts, stops and action presses immediately; batch steady movement.
  if((urgent||now-this.lastSend>=30)&&this.outbox.length){
   if(this.socket.bufferedAmount>65536||this.outbox.length>120){this.socket.close(4000,'Slow connection');return;}
   while(this.outbox.length){const commands=this.outbox.splice(0,8);this.socket.send(JSON.stringify({type:'input',generation:this.generation,commands}));}
   this.lastSend=now;
  }
  return stepped;
 }
 render(now,dt){return this.view.render(now,dt);}
 diagnostics(now=performance.now()){
  const times=this.snapshotTimes.filter(at=>now-at<=2000);
  const gaps=times.slice(1).map((at,i)=>at-times[i]);
  const last=this.snapshotTimes.at(-1);
  return {
   connected:this.ready,
   rtt:this.ready&&this.lastPong!==null&&now-this.lastPong<3000?this.rtt:null,
   snapshotHz:gaps.length?1000*gaps.length/(times.at(-1)-times[0]):null,
   maxGap:gaps.length?Math.max(...gaps):null,
   snapshotAge:last===undefined?null:now-last,
   interpolationMs:INTERPOLATION_MS,
   pendingInputs:this.view.pending.length,
   bufferedBytes:this.socket?.bufferedAmount||0,
  };
 }
 close(){this.closed=true;this.ready=false;clearInterval(this.heartbeat);clearTimeout(this.retry);this.socket?.close();this.view.reset();}
}
