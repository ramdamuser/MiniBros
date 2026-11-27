import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'minibros-browser-'));
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3108'},stdio:['ignore','pipe','pipe']});
let browser;
try {
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`Server exited: ${code}`)));});
 browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-pipe',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 let next=0,buffer='';const pending=new Map(),errors=[];
 browser.stdio[4].on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\0'))>=0){const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(msg.id){const entry=pending.get(msg.id);if(entry){pending.delete(msg.id);msg.error?entry.reject(Error(JSON.stringify(msg.error))):entry.resolve(msg.result);}}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});

 const createPage=async()=>{
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Runtime.enable',{},sessionId);
  await call('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
  await call('Page.navigate',{url:'http://localhost:3108'},sessionId);
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
  const until=async(expression,timeout=15000)=>{const end=Date.now()+timeout;while(!await evaluate(expression)){if(Date.now()>=end){console.log('Page failure',await evaluate(`({visibility:document.visibilityState,body:document.body.innerText,client:window.client?{closed:client.closed,room:client.room,ready:client.ready,peers:[...client.peers.values()].map(p=>({id:p.id,state:p.pc.connectionState,ice:p.pc.iceConnectionState,control:p.control?.readyState,snapshots:p.snapshots?.readyState}))}:null})`),errors);throw Error('Timed out: '+expression);}await new Promise(r=>setTimeout(r,50));}};
  await until("typeof document.querySelector('#host')?.onclick==='function'");
  await evaluate(`(async()=>{
   const {PeerMultiplayer}=await import('/peer-multiplayer.js');
   const update=PeerMultiplayer.prototype.update;
   PeerMultiplayer.prototype.update=function(...args){window.client=this;return update.apply(this,args)};
   window.wsGameplay=0;const send=WebSocket.prototype.send;
   WebSocket.prototype.send=function(raw){const m=JSON.parse(raw);if(m.type==='input'||m.type==='state')window.wsGameplay++;return send.call(this,raw)};
  })()`);
  return {evaluate,until};
 };
 const host=await createPage(),guest=await createPage();
 await host.evaluate("document.querySelector('#host').click();document.querySelector('#limit').value='4';document.querySelector('#enter').click()");
 await host.until("!!document.querySelector('.room-code')");
 const code=await host.evaluate("document.querySelector('.room-code').textContent");
 await guest.evaluate(`document.querySelector('#join').click();document.querySelector('#code').value=${JSON.stringify(code)};document.querySelector('#enter').click()`);
 const others=[await createPage(),await createPage()];
 for(const page of others){
  await page.evaluate(`document.querySelector('#join').click();document.querySelector('#code').value=${JSON.stringify(code)};document.querySelector('#enter').click()`);
  await page.until('window.client?.ready');
 }
 await host.until("window.client?.canStart&&client.room.players.length===4");
 await host.until("!document.querySelector('#start-party').disabled");
 await host.evaluate("document.querySelector('#start-party').click()");
 await guest.until("window.client?.view.game?.phase==='fight'");
 await host.until("window.client?.authoritative?.phase==='fight'");
 await guest.evaluate("document.querySelector('#network-debug').open=true");
 await guest.until("document.querySelector('#network-values').textContent.includes('Host RTT')");
 assert.equal(await host.evaluate('client.authoritative.players.length'),4);
 assert.equal(await host.evaluate('client.diagnostics().interpolationMs'),0,'Host renders authority without interpolation');
 const before=await guest.evaluate("client.view.local.x");
 await guest.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'}));window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}))");
 await new Promise(r=>setTimeout(r,200));
 await guest.evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyA'}))");
 await guest.until(`client.view.local.x<${before}-5`);
 const guestId=await guest.evaluate('client.id');
 await host.until(`(()=>{const p=client.authoritative.players.find(p=>p.id===${JSON.stringify(guestId)});return p.x<${before}-5&&p.y<490})()`);
 const actual=await host.evaluate(`client.authoritative.players.find(p=>p.id===${JSON.stringify(guestId)})`);
 assert.ok(actual.x<before-5,'Guest movement reaches host authority');
 assert.ok(actual.y<490,'Guest quick-tap jump reaches host authority');
 await guest.until('client.diagnostics().rtt!==null');
 assert.equal(await guest.evaluate('window.wsGameplay'),0,'No gameplay traverses signaling WebSocket');
 assert.equal(await host.evaluate('window.wsGameplay'),0);
 assert.ok(await guest.evaluate("client.diagnostics().transport.includes('Direct')"));
 // Old / reordered full snapshots must not overwrite current state.
 assert.ok(await guest.evaluate(`(()=>{const tick=client.lastTick,x=client.view.local.x;client.receive({generation:client.generation,tick:tick-1,game:{bad:true}},performance.now());return client.lastTick===tick&&client.view.local.x===x})()`));
 const gen=await host.evaluate('client.generation');
 await host.evaluate("client.authoritative.phase='over'");
 await host.until("!document.querySelector('#rematch').hidden");
 await host.evaluate("document.querySelector('#rematch').click()");
 await guest.until(`client.generation===${gen+1}&&client.view.game?.phase==='countdown'`);
 await guest.until("client.view.game?.phase==='fight'");
 const report=await guest.evaluate('client.diagnostics()');
 console.log('WebRTC diagnostics:',JSON.stringify(report,null,2));
 // Even several lost snapshots cannot poison a delta baseline (frames are full).
 await guest.evaluate(`window.savedSnapshotHandler=client.peers.get(client.room.host).snapshots.onmessage;client.peers.get(client.room.host).snapshots.onmessage=()=>{}`);
 await new Promise(r=>setTimeout(r,250));
 const stalledTick=await guest.evaluate('client.lastTick');
 await guest.evaluate('client.peers.get(client.room.host).snapshots.onmessage=window.savedSnapshotHandler');
 await guest.until(`client.lastTick>${stalledTick}`);
 // Closing the host ends the guest session instead of silently changing authority.
 await host.evaluate("client.close()");
 await guest.until("document.querySelector('#game').hidden");
 for(const page of others)await page.until("document.querySelector('#game').hidden&&client.closed");
 assert.deepEqual(errors,[],'No browser exceptions');
 await new Promise((resolve,reject)=>{
  const checks=spawn(process.execPath,['test/rooms.mjs'],{env:{...process.env,TEST_URL:'http://127.0.0.1:3108'},stdio:'inherit'});
  checks.on('error',reject);checks.on('exit',code=>code?reject(Error(`Room checks exited ${code}`)):resolve());
 });
 console.log('WebRTC browser checks passed: real data channels, host authority, guest input/prediction, direct RTT, no signaling gameplay, stale snapshots, rematch and host departure.');
} finally {if(browser){browser.kill();await new Promise(resolve=>browser.once('exit',resolve));}server.kill();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
