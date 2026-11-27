import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHmac} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {WebSocketServer,WebSocket} from 'ws';
import {match,step,roster} from './public/engine.js';
import {InputQueue,FIXED_DT} from './public/netcode.js';
import {SnapshotEncoder} from './public/protocol.js';
const rooms=new Map(),sessions=new Map();
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
function snapshot(r){return {transport:r.transport,started:!!r.started,code:r.code,host:r.host,limit:r.limit,theme:r.theme,players:r.players.map(({id,name})=>({id,name})),generation:r.generation,game:r.game};}
function rtcConfig(id){
 const iceServers=[{urls:(process.env.STUN_URLS||'stun:stun.l.google.com:19302').split(',')}];
 if(process.env.TURN_URLS&&process.env.TURN_SECRET){
  const username=`${Math.floor(Date.now()/1000)+86400}:${id}`;
  iceServers.push({urls:process.env.TURN_URLS.split(','),username,credential:createHmac('sha1',process.env.TURN_SECRET).update(username).digest('base64')});
 }
 return {iceServers};
}
function remove(token){
 const session=sessions.get(token);if(!session)return;
 const r=session.room;
 if(r.transport==='webrtc'&&r.host===session.id){
  rooms.delete(r.code);
  for(const [key,s] of sessions)if(s.room===r){sessions.delete(key);s.socket?.close(4001,'The player host left. Create or join a new party.');}
  return;
 }
 sessions.delete(token);session.socket?.close(1000,'Left party');
 r.players=r.players.filter(p=>p.id!==session.id);delete r.inputs[session.id];
 if(r.game)r.game.players=r.game.players.filter(p=>p.id!==session.id);
 if(!r.players.length)rooms.delete(r.code);else if(r.host===session.id)r.host=r.players[0].id;
}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='POST'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)return send(res,413,{error:'Request too large'});}
   const body=JSON.parse(raw||'{}');const session=sessions.get(body.token);let r=session?.room;
   if(session)session.seen=Date.now();
   if(url.pathname==='/api/create'||url.pathname==='/api/join'){
    if(sessions.size>=200)return send(res,503,{error:'Server full'});
    if(!Object.hasOwnProperty.call(roster,body.name))return send(res,400,{error:'Choose a fighter'});
    if(url.pathname==='/api/create'){
     let code;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
     r={code,transport:body.transport==='webrtc'?'webrtc':'server',limit:[2,3,4].includes(+body.limit)?+body.limit:2,theme:body.theme==='night'?'night':'day',players:[],inputs:{},game:null,generation:0};rooms.set(code,r);
    }else{
     r=rooms.get(String(body.code).toUpperCase());
     if(!r)return send(res,404,{error:'Room not found. Check the code.'});
     if(r.game||r.started||r.players.length>=r.limit)return send(res,409,{error:'Room is full or already playing.'});
    }
    const id=randomBytes(6).toString('hex'),token=randomBytes(24).toString('hex');
    r.players.push({id,name:body.name});r.host??=id;
    sessions.set(token,{id,room:r,seen:Date.now(),input:new InputQueue(),inputAt:Date.now()});
    return send(res,200,{token,id,room:snapshot(r)});
   }
   if(!session)return send(res,401,{error:'Room session expired'});
   if(url.pathname==='/api/start'){
    if(r.host!==session.id||r.players.length<2)return send(res,403,{error:'The host needs at least two players to start.'});
    if(r.transport==='webrtc'){
     if(!r.players.every(p=>p.id===r.host||session.peerReady?.includes(p.id)))return send(res,409,{error:'Wait for every player to connect through WebRTC.'});
     r.started=true;r.generation++;
    }else if(!r.game||r.game.phase==='over'){
     r.game=match(r.players,r.theme);r.generation++;
     for(const s of sessions.values())if(s.room===r)s.input.reset(s.input.received);
    }
   }else if(url.pathname==='/api/leave')remove(body.token);
   else return send(res,404,{error:'Not found'});
   return send(res,200,{ok:true});
  }
  const files={'/':'index.html','/app.js':'app.js','/engine.js':'engine.js','/balance.js':'balance.js','/abilities.js':'abilities.js','/protocol.js':'protocol.js','/netcode.js':'netcode.js','/multiplayer.js':'multiplayer.js','/peer-multiplayer.js':'peer-multiplayer.js','/style.css':'style.css'};
  const file=files[url.pathname];if(!file){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-cache'});
  res.end(await readFile(new URL(`./public/${file}`,import.meta.url)));
 }catch{send(res,400,{error:'Invalid request'});}
});
const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
 socket.setNoDelay(true);
 const onError=()=>socket.destroy();socket.on('error',onError);
 if(req.url!=='/ws'){socket.destroy();return;}
 if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){socket.destroy();return;}}catch{socket.destroy();return;}}
 wss.handleUpgrade(req,socket,head,ws=>{socket.removeListener('error',onError);wss.emit('connection',ws);});
});
wss.on('connection',ws=>{
 let session;
 const authTimer=setTimeout(()=>ws.close(1008,'Authentication required'),5000);
 ws.on('error',()=>{});
 ws.on('message',raw=>{
  try{
   const message=JSON.parse(raw.toString());
   if(!session){
    session=message.type==='auth'?sessions.get(message.token):null;
    if(!session){ws.close(1008,'Room session expired');return;}
    clearTimeout(authTimer);session.socket?.close(4001,'Connection replaced');
    session.revision=0;session.socket=ws;session.input.reset(session.input.ack);session.seen=Date.now();session.inputAt=Date.now();
    ws.send(JSON.stringify({type:'welcome',...snapshot(session.room),ack:session.input.ack,...(session.room.transport==='webrtc'?{rtcConfig:rtcConfig(session.id)}:{})}));return;
   }
   if(session.socket!==ws)return;
   session.seen=Date.now();
   if(session.room.transport==='webrtc'){
    const r=session.room;
    if(message.type==='ping'){ws.send(JSON.stringify({type:'pong',at:message.at}));return;}
    if(message.type==='peer-ready'&&session.id===r.host){
     session.peerReady=Array.isArray(message.players)?message.players.filter(id=>r.players.some(p=>p.id===id)):[];return;
    }
    if(message.type==='rtc'){
     const now=Date.now();if(now-(session.signalWindow||0)>1000){session.signalWindow=now;session.signalCount=0;}
     if(++session.signalCount>100)throw Error('Too many signals');
     const target=[...sessions.values()].find(s=>s.room===r&&s.id===message.to);
     if(!target||target===session||(session.id!==r.host&&target.id!==r.host))return;
     if(!message.signal||JSON.stringify(message.signal).length>12000)throw Error('Invalid signal');
     if(target.socket?.readyState===WebSocket.OPEN)target.socket.send(JSON.stringify({type:'rtc',from:session.id,signal:message.signal}));
    }
    return;
   }
   if(message.type==='resync'){session.revision=0;return;}
   if(message.type==='ping'){ws.send(JSON.stringify({type:'pong',at:message.at}));return;}
   if(message.type!=='input'||message.generation!==session.room.generation)return;
   session.input.push(message.commands);session.inputAt=Date.now();
  }catch{ws.close(1008,'Invalid input');}
 });
 ws.on('close',()=>{clearTimeout(authTimer);if(session?.socket===ws){session.socket=null;if(session.room.transport==='webrtc'){for(const [key,s] of sessions)if(s===session){remove(key);break;}return;}session.input.reset(session.input.ack);session.room.inputs[session.id]={};}});
});
let previous=performance.now(),accumulator=0,tick=0,lastBroadcast=previous;
// Session housekeeping does not belong in the 60 Hz simulation loop.
setInterval(()=>{
 const now=Date.now();
 for(const [token,s] of sessions){
  if(now-s.seen>15000)remove(token);
  else if(now-s.inputAt>1000){s.input.reset(s.input.received);s.inputAt=now;}
 }
},1000).unref();
setInterval(()=>{
 const now=performance.now();accumulator+=Math.min((now-previous)/1000,.25);previous=now;
 while(accumulator>=FIXED_DT){
  accumulator-=FIXED_DT;tick++;
  for(const s of sessions.values())s.room.inputs[s.id]=s.input.next();
  for(const r of rooms.values())if(r.game)step(r.game,r.inputs,FIXED_DT);
 }
 // Wall-clock pacing: at most one snapshot per 50 ms, including after a stall.
 if(now-lastBroadcast<50)return;
 lastBroadcast=now;
 for(const r of rooms.values()){
  if(r.transport==='webrtc')continue;
  r.encoder??=new SnapshotEncoder();
  r.wire=r.encoder.encode(snapshot(r),tick);
 }
 for(const s of sessions.values()){
  if(s.socket?.readyState!==WebSocket.OPEN)continue;
  if(s.room.transport==='webrtc'){
   const state=JSON.stringify({type:'room',...snapshot(s.room)});
   if(state!==s.lastRoom&&s.socket.bufferedAmount===0){s.socket.send(state);s.lastRoom=state;}
   continue;
  }
  // Never append more simulation data behind stale queued frames. A skipped
  // delta forces a full baseline on the next writable broadcast.
  if(s.socket.bufferedAmount>0)continue;
  const wire=s.room.wire;
  const payload=s.revision===wire.base?wire.delta:wire.full;
  s.socket.send('["snapshot",'+s.input.ack+','+payload+']');
  s.revision=wire.revision;
 }
},4).unref();
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('MiniBros: http://localhost:'+(process.env.PORT||3000)));
