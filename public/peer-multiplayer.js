import {Multiplayer} from './multiplayer.js';
import {match,step} from './engine.js';
import {InputQueue,MatchView,FIXED_DT} from './netcode.js';

// Render only carries room metadata and authenticated signaling. The host owns
// the simulation; guests retain the existing prediction/reconciliation path.
export class PeerMultiplayer {
 constructor({token,id,onState,onStatus,onExpired}){
  Object.assign(this,{token,id,onState,onStatus,onExpired,seq:0,generation:0,outbox:[],accumulator:0,
   lastHeld:{},edges:{},ready:false,closed:false,lastSend:0,rtt:null,lastPong:null,snapshotTimes:[],
   peers:new Map(),view:new MatchView(id),tick:0,simAccumulator:0,lastBroadcast:0,lastTick:-1});
  this.localInput=new InputQueue();
  // Adapt the existing input batching code to a data channel (or local queue).
  const self=this;
  this.socket={get bufferedAmount(){return self.isHost?0:(self.peers.get(self.room?.host)?.control?.bufferedAmount||0);},
   send(raw){if(self.isHost)self.localInput.push(JSON.parse(raw).commands);else self.send(self.peers.get(self.room.host)?.control,raw);},
   close(){self.fail('The peer connection is too slow. Please create a new party.');}};
  this.signaling=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
  this.signaling.onopen=()=>this.signalSend({type:'auth',token});
  let messages=Promise.resolve();
  this.signaling.onmessage=e=>{messages=messages.then(()=>this.signalingMessage(JSON.parse(e.data))).catch(()=>this.fail('WebRTC setup failed. Try server-hosted mode or configure TURN.'));};
  this.signaling.onclose=e=>this.fail(e.reason||'The room connection closed. Please create a new party.');
  this.signaling.onerror=()=>{};
  this.heartbeat=setInterval(()=>this.maintain(),1000);
 }
 get isHost(){return this.room?.host===this.id;}
 get canStart(){return this.isHost&&this.room.players.length>1&&this.room.players.every(p=>p.id===this.id||this.peerOpen(this.peers.get(p.id)));}
 peerOpen(p){return p?.control?.readyState==='open'&&p?.snapshots?.readyState==='open';}
 signalSend(message){if(this.signaling.readyState===WebSocket.OPEN)this.signaling.send(JSON.stringify(message));}
 send(channel,raw){if(channel?.readyState==='open')channel.send(raw);}
 async signalingMessage(message){
  if(this.closed)return;
  if(message.type==='welcome'||message.type==='room'){
   if(message.rtcConfig)this.rtcConfig=message.rtcConfig;
   if(this.room?.started&&this.room.players.some(old=>!message.players.some(p=>p.id===old.id))){this.fail('A player left the match. Please create a new party.');return;}
   this.room=message;
   if(!this.rtcConfig)return;
   for(const [id,p] of this.peers)if(!message.players.some(player=>player.id===id)){this.peers.delete(id);p.pc.close();}
   if(message.generation!==this.generation){
    this.generation=message.generation;this.resetMatch();
    if(this.isHost&&message.started)this.authoritative=match(message.players,message.theme);
   }
   this.ready=this.isHost||this.peerOpen(this.peers.get(message.host));
   if(!this.isHost&&!this.peers.has(message.host))this.signalSend({type:'rtc',to:message.host,signal:{hello:true}});
   if(!message.started)this.onState(message);
   this.onStatus('peers');return;
  }
  if(message.type!=='rtc'||!this.room)return;
  const {from,signal}=message;
  // The server enforces same-room, host-to-guest signaling routes.
  if(!this.isHost&&from!==this.room.host)return;
  let p=this.peers.get(from);
  if(signal.hello){
   if(!this.isHost||p)return;
   p=this.createPeer(from);
   this.bindChannel(p,p.pc.createDataChannel('control',{ordered:true}));
   this.bindChannel(p,p.pc.createDataChannel('snapshots',{ordered:false,maxRetransmits:0}));
   await p.pc.setLocalDescription(await p.pc.createOffer());
   this.signalSend({type:'rtc',to:from,signal:{description:p.pc.localDescription}});return;
  }
  if(signal.description){
   if(this.isHost&&signal.description.type!=='answer'||!this.isHost&&signal.description.type!=='offer')return;
   p??=this.createPeer(from);
   await p.pc.setRemoteDescription(signal.description);
   for(const candidate of p.candidates)await p.pc.addIceCandidate(candidate);
   p.candidates=[];
   if(signal.description.type==='offer'){
    await p.pc.setLocalDescription(await p.pc.createAnswer());
    this.signalSend({type:'rtc',to:from,signal:{description:p.pc.localDescription}});
   }
  }else if(signal.candidate){
   p??=this.createPeer(from);
   if(p.pc.remoteDescription)await p.pc.addIceCandidate(signal.candidate);else p.candidates.push(signal.candidate);
  }
 }
 createPeer(id){
  const pc=new RTCPeerConnection(this.rtcConfig);
  const p={id,pc,candidates:[],input:new InputQueue(),inputAt:performance.now(),created:performance.now(),rtt:null,pongAt:null,path:'Checking',lastReceived:performance.now()};
  this.peers.set(id,p);
  pc.onicecandidate=e=>{if(e.candidate)this.signalSend({type:'rtc',to:id,signal:{candidate:e.candidate}});};
  pc.ondatachannel=e=>this.bindChannel(p,e.channel);
  pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed'&&this.peers.get(id)===p)this.fail('A WebRTC connection failed. Try server-hosted mode or configure TURN.');};
  return p;
 }
 bindChannel(p,channel){
  if(!['control','snapshots'].includes(channel.label)||p[channel.label]){channel.close();return;}
  p[channel.label]=channel;
  channel.onopen=()=>{
   if(this.closed)return;
   this.ready=this.isHost||this.peerOpen(p);this.reportReady();this.onStatus('peers');
  };
  channel.onclose=()=>{if(!this.closed&&this.peers.get(p.id)===p){this.reportReady();this.fail('A player disconnected. Please create a new party.');}};
  channel.onerror=()=>{};
  channel.onmessage=e=>{
   if(this.closed||typeof e.data!=='string'||e.data.length>65536)return;
   try{
    const message=JSON.parse(e.data),now=performance.now();p.lastReceived=now;
    if(channel.label==='snapshots'){
     if(!this.isHost&&message.type==='state')this.receive(message,now);
     return;
    }
    if(message.type==='ping'){this.send(p.control,JSON.stringify({type:'pong',at:message.at}));return;}
    if(message.type==='pong'){
     if(Number.isFinite(message.at)&&message.at===p.pingAt){p.rtt=Math.round(now-message.at);p.pongAt=now;}
     return;
    }
    if(this.isHost&&message.type==='input'&&message.generation===this.generation){p.input.push(message.commands);p.inputAt=now;}
   }catch{this.fail('Invalid peer data. Please create a new party.');}
  };
 }
 reportReady(){if(this.isHost)this.signalSend({type:'peer-ready',players:[...this.peers.values()].filter(p=>this.peerOpen(p)).map(p=>p.id)});}
 resetMatch(){
  this.view.reset();this.outbox=[];this.edges={};this.lastHeld={};this.lastCommand=null;
  this.accumulator=0;this.simAccumulator=0;this.lastTick=-1;this.tick=0;this.snapshotTimes=[];
  this.localInput.reset(this.seq);
  for(const p of this.peers.values())p.input.reset(p.input.received);
 }
 receive(packet,now){
  // Snapshots are independent full frames: loss needs no baseline repair, and
  // reordered or previous-match frames cannot rewind the view.
  if(packet.generation!==this.generation||!Number.isSafeInteger(packet.tick)||packet.tick<=this.lastTick||!packet.game)return;
  this.lastTick=packet.tick;
  if(this.view.game?.phase!==packet.game.phase||this.view.game?.round!==packet.game.round){this.outbox=[];this.edges={};this.lastHeld={};this.accumulator=0;this.lastCommand=null;}
  this.snapshotTimes.push(now);this.snapshotTimes=this.snapshotTimes.filter(at=>now-at<=2000);
  this.view.receive(packet,now);this.onState({...this.room,...packet});
 }
 update(held,dt,now){
  if(!this.ready||!this.room?.started)return false;
  if(this.isHost)this.lastSend=-Infinity; // Local host input never waits for a batch.
  const stepped=Multiplayer.prototype.update.call(this,held,dt,now);
  if(!this.isHost||!this.authoritative)return stepped;
  this.simAccumulator+=Math.min(dt,.1);
  while(this.simAccumulator>=FIXED_DT){
   this.simAccumulator-=FIXED_DT;this.tick++;
   const inputs={[this.id]:this.localInput.next()};
   for(const p of this.peers.values()){
    if(now-p.inputAt>1000){p.input.reset(p.input.received);p.inputAt=now;}
    inputs[p.id]=p.input.next();
   }
   step(this.authoritative,inputs,FIXED_DT);
  }
  const state={type:'state',generation:this.generation,tick:this.tick,game:this.authoritative};
  // Copy before reconciliation: prediction must never mutate host authority.
  this.receive({...state,game:structuredClone(this.authoritative),ack:this.localInput.ack},now);
  if(now-this.lastBroadcast>=50){
   this.lastBroadcast=now;
   for(const p of this.peers.values())if(this.peerOpen(p)&&p.snapshots.bufferedAmount===0)
    this.send(p.snapshots,JSON.stringify({...state,ack:p.input.ack}));
  }
  return stepped;
 }
 maintain(){
  if(this.closed)return;
  const now=performance.now();this.signalSend({type:'ping',at:now});
  if(this.room&&!this.isHost&&!this.peers.has(this.room.host))this.signalSend({type:'rtc',to:this.room.host,signal:{hello:true}});
  for(const p of this.peers.values()){
   if(!this.peerOpen(p)){
    if(now-p.created>20000)this.fail('WebRTC could not connect. Configure TURN or create a server-hosted party.');
    continue;
   }
   if(now-p.lastReceived>15000){this.fail('The player connection timed out. Please create a new party.');return;}
   p.pingAt=now;this.send(p.control,JSON.stringify({type:'ping',at:now}));
   p.pc.getStats().then(stats=>{
    let pair;stats.forEach(s=>{if(s.type==='transport'&&s.selectedCandidatePairId)pair=stats.get(s.selectedCandidatePairId);});
    if(!pair)stats.forEach(s=>{if(s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded')pair=s;});
    if(pair){const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);
     p.path=local?.candidateType==='relay'||remote?.candidateType==='relay'?'TURN relay':'Direct';
    }
   }).catch(()=>{});
  }
 }
 diagnostics(now=performance.now()){
  const active=[...this.peers.values()].filter(p=>this.peerOpen(p));
  const samples=active.filter(p=>p.pongAt!==null&&now-p.pongAt<3000);
  this.rtt=samples.length?Math.max(...samples.map(p=>p.rtt)):null;
  this.lastPong=samples.length?Math.max(...samples.map(p=>p.pongAt)):null;
  const base=Multiplayer.prototype.diagnostics.call(this,now);
  return {...base,
   transport:`WebRTC ${this.isHost?'host':'guest'} · ${active.map(p=>p.path).join(', ')||'Connecting'}`,
   interpolationMs:this.isHost?0:base.interpolationMs,
   pingLabel:this.isHost?'Worst peer RTT':'Host RTT',
   snapshotLabel:this.isHost?'Local sim rate':'Snapshots',
   bufferedBytes:active.reduce((sum,p)=>sum+p.control.bufferedAmount+p.snapshots.bufferedAmount,0)};
 }
 press(action){Multiplayer.prototype.press.call(this,action);}
 clear(){Multiplayer.prototype.clear.call(this);}
 render(now,dt){return this.isHost&&this.authoritative?this.authoritative:this.view.render(now,dt);}
 fail(message){if(this.closed)return;this.close();this.onExpired(message);}
 close(){
  if(this.closed)return;this.closed=true;this.ready=false;clearInterval(this.heartbeat);
  for(const p of this.peers.values())p.pc.close();this.peers.clear();
  this.signaling.close();this.view.reset();
 }
}
