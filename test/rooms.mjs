import http from 'node:http';
import assert from 'node:assert/strict';
function request(path,data){return new Promise((resolve,reject)=>{const req=http.request('http://127.0.0.1:3000'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:res.headers['content-type'].includes('json')?JSON.parse(raw):raw}));});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);});}
const page=await request('/');assert.equal(page.status,200);assert.ok(page.data.includes('MiniBros'));
const host=(await request('/api/create',{name:'Naruto',limit:2,theme:'night'})).data;assert.equal(host.room.code.length,6);assert.notEqual(host.id,host.token);assert.ok(!JSON.stringify(host.room).includes(host.token));
const guest=(await request('/api/join',{name:'Luffy',code:host.room.code})).data;
assert.equal((await request('/api/join',{name:'Ippo',code:host.room.code})).status,409);
assert.equal((await request('/api/start',{token:guest.token})).status,403);
assert.equal((await request('/api/start',{token:host.id})).status,401);
assert.equal((await request('/api/start',{token:host.token})).status,200);
assert.equal((await request('/api/input',{token:guest.token,input:{left:true}})).status,200);
await new Promise((resolve,reject)=>{const req=http.get('http://127.0.0.1:3000/events?token='+host.token,res=>{res.once('data',chunk=>{try{const state=JSON.parse(chunk.toString().split('data: ')[1]);assert.equal(state.game.theme,'night');assert.equal(state.game.players.length,2);req.destroy();resolve();}catch(e){reject(e);}});});req.on('error',reject);});
await request('/api/leave',{token:guest.token});await request('/api/leave',{token:host.token});assert.equal((await request('/api/join',{name:'Ippo',code:host.room.code})).status,404);
console.log('HTTP and multiplayer checks passed: page, create, join, capacity, host authority, private session tokens, start, inputs, SSE state, leave, cleanup.');
