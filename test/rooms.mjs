import {SnapshotDecoder} from '../public/protocol.js';
import http from 'node:http';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=process.env.TEST_URL||'http://127.0.0.1:3000';
function request(path,data){return new Promise((resolve,reject)=>{const req=http.request(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:res.headers['content-type'].includes('json')?JSON.parse(raw):raw}));});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);});}
function connect(token){return new Promise((resolve,reject)=>{
 const ws=new WebSocket(base.replace('http','ws')+'/ws');const states=[];const decoder=new SnapshotDecoder();
 ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'auth',token})));
 ws.on('message',raw=>{let state=JSON.parse(raw);if(Array.isArray(state))state=decoder.decode(state[2],state[1]);states.push(state);if(state.type==='welcome')resolve({ws,states});});
 ws.on('close',code=>{if(!states.length)reject(Error(`Closed ${code}`));});
});}
async function until(fn){const end=Date.now()+5000;while(!fn()){assert.ok(Date.now()<end,'Timed out waiting for server state');await new Promise(r=>setTimeout(r,10));}}
const page=await request('/');assert.equal(page.status,200);
const host=(await request('/api/create',{name:'Naruto',limit:2,theme:'night'})).data;
const guest=(await request('/api/join',{name:'Luffy',code:host.room.code})).data;
let a,b;
try{
 assert.notEqual(host.id,host.token);assert.ok(!JSON.stringify(host.room).includes(host.token));
 assert.equal((await request('/api/join',{name:'Ippo',code:host.room.code})).status,409);
 assert.equal((await request('/api/start',{token:guest.token})).status,403);
 assert.equal((await request('/api/start',{token:host.id})).status,401);
 await assert.rejects(connect(host.id),/Closed 1008/,'Public player IDs must not authenticate');
 a=await connect(host.token);b=await connect(guest.token);
 assert.equal((await request('/api/start',{token:host.token})).status,200);
 await until(()=>a.states.some(s=>s.game?.phase==='fight'));
 const state=a.states.at(-1);assert.equal(state.game.theme,'night');assert.equal(state.game.players.length,2);
 const commands=[{seq:1,input:{presses:{jump:true}}},{seq:2,input:{}}];
 a.ws.send(JSON.stringify({type:'input',generation:state.generation,commands}));
 await until(()=>a.states.some(s=>s.ack===2));
 const jumped=a.states.find(s=>s.ack===2).game.players.find(p=>p.id===host.id);
 assert.ok(jumped.y<500,'A press and release delivered together must produce an authoritative jump');
 a.ws.send(JSON.stringify({type:'input',generation:state.generation,commands}));
 await new Promise(r=>setTimeout(r,100));assert.equal(a.states.at(-1).ack,2,'Duplicate commands are ignored');
 a.ws.close();await until(()=>a.ws.readyState===WebSocket.CLOSED);a=await connect(host.token);
 assert.equal(a.states[0].ack,2,'Reconnect resumes from processed sequence');
 a.ws.send(JSON.stringify({type:'input',generation:state.generation-1,commands:[{seq:3,input:{presses:{jump:true}}}]}));
 await new Promise(r=>setTimeout(r,100));assert.equal(a.states.at(-1).ack,2,'Old-match commands are ignored');
 console.log('Room and WebSocket checks passed: authority, authentication, streaming, quick taps, duplicates, reconnect and stale-match input.');
}finally{a?.ws.close();b?.ws.close();await request('/api/leave',{token:guest.token});await request('/api/leave',{token:host.token});}
assert.equal((await request('/api/join',{name:'Ippo',code:host.room.code})).status,404);

// WebRTC signaling must remain room-scoped and cannot start server simulation.
const peerHost=(await request('/api/create',{name:'Naruto',limit:3,transport:'webrtc'})).data;
const peerGuest=(await request('/api/join',{name:'Luffy',code:peerHost.room.code})).data;
const outsider=(await request('/api/create',{name:'Ippo'})).data;
let ph,pg,out;
try{
 ph=await connect(peerHost.token);pg=await connect(peerGuest.token);out=await connect(outsider.token);
 assert.ok(ph.states[0].rtcConfig.iceServers.length);
 assert.equal((await request('/api/start',{token:peerHost.token})).status,409,'Unconnected peers cannot start');
 pg.ws.send(JSON.stringify({type:'rtc',to:peerHost.id,signal:{hello:true}}));
 await until(()=>ph.states.some(s=>s.type==='rtc'&&s.from===peerGuest.id));
 out.ws.send(JSON.stringify({type:'rtc',to:peerHost.id,signal:{hello:true}}));
 ph.ws.send(JSON.stringify({type:'peer-ready',players:[peerGuest.id]}));
 await new Promise(r=>setTimeout(r,100));
 assert.ok(!ph.states.some(s=>s.type==='rtc'&&s.from===outsider.id),'Cross-room signals must not arrive');
 assert.equal((await request('/api/start',{token:peerHost.token})).status,200);
 await until(()=>pg.states.some(s=>s.type==='room'&&s.started&&s.generation===1));
 assert.ok(pg.states.every(s=>!s.game),'Render must not run a WebRTC room simulation');
 assert.equal((await request('/api/join',{name:'Ippo',code:peerHost.room.code})).status,409,'Active peer rooms reject late joins');
 assert.equal((await request('/api/start',{token:peerGuest.token})).status,403);
 assert.equal((await request('/api/start',{token:peerHost.token})).status,200,'Host can start a rematch');
 await until(()=>pg.states.some(s=>s.generation===2));
 ph.ws.close();await until(()=>pg.ws.readyState===WebSocket.CLOSED);
 assert.equal((await request('/api/join',{name:'Ippo',code:peerHost.room.code})).status,404,'Host departure closes room');
 console.log('WebRTC signaling checks passed: room isolation, readiness, host authority, rematch and departure.');
}finally{
 ph?.ws.close();pg?.ws.close();out?.ws.close();
 await request('/api/leave',{token:peerGuest.token});await request('/api/leave',{token:peerHost.token});await request('/api/leave',{token:outsider.token});
}
