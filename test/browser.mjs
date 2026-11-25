import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'minibros-browser-'));
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3107'},stdio:['ignore','pipe','pipe']});
let browser;
try {
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`Server exited: ${code}`)));});
 browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-pipe',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
 let next=0,buffer='';const pending=new Map(),errors=[];
 browser.stdio[4].on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\0'))>=0){const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(msg.id){const entry=pending.get(msg.id);if(entry){pending.delete(msg.id);msg.error?entry.reject(Error(JSON.stringify(msg.error))):entry.resolve(msg.result);}}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 await call('Runtime.enable',{},sessionId);await call('Page.enable',{},sessionId);
 // A denied Gamepad API is common in embedded browser previews.
 if(process.env.DENY_GAMEPAD)await call('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator, 'getGamepads', {value(){throw new DOMException('Gamepad access blocked by permissions policy', 'SecurityError')}});"},sessionId);
 await call('Page.navigate',{url:'http://localhost:3107'},sessionId);
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
 const readyUntil=Date.now()+15000;
 while(!await evaluate("typeof document.querySelector('#single')?.onclick==='function'")){
  assert.ok(Date.now()<readyUntil,'Lobby must finish loading');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 await evaluate("document.querySelector('#single').click();document.querySelector('#begin').click()");
 await new Promise(resolve=>setTimeout(resolve,4200));
 const state=await evaluate("({hidden:document.querySelector('#game').hidden,modal:document.querySelector('#modal').open,timer:document.querySelector('#timer').textContent,hud:document.querySelector('#hud').textContent,pixel:Array.from(document.querySelector('#arena').getContext('2d').getImageData(50,50,1,1).data)})");
 console.log(JSON.stringify({deniedGamepad:!!process.env.DENY_GAMEPAD,state,errors},null,2));
 assert.deepEqual(errors,[],'Browser must not throw');assert.equal(state.hidden,false);assert.equal(state.modal,false);assert.ok(state.hud.includes('Naruto'));assert.notEqual(state.timer,'1:30');assert.equal(state.pixel[3],255,'Arena must render');
 await evaluate(`window.playerDraws=[];const draw=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(text==='YOU')window.playerDraws.push({x,y,at:performance.now()});return draw.call(this,text,x,y,...rest)};window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'}));`);
 await new Promise(resolve=>setTimeout(resolve,250));
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyA'}));window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL'}))");
 await new Promise(resolve=>setTimeout(resolve,100));
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyL'}))");
 const positions=await evaluate('window.playerDraws');
 assert.ok(positions.length>2,'Animation continues during keyboard input');
 assert.ok(positions.at(-1).x<positions[0].x,'Keyboard movement works');
 assert.deepEqual(errors,[],'Movement and parry must render without exceptions');
 console.log('Singleplayer browser launch, countdown, keyboard movement, and parry passed.');
 const abilityBar=await evaluate("Array.from(document.querySelectorAll('.ability-card')).map(c=>({id:c.dataset.ability,name:c.querySelector('.ability-name').textContent,key:c.querySelector('kbd').textContent,cost:c.querySelector('.ability-cost').textContent}))");
 assert.equal(abilityBar.length,6);
 assert.equal(abilityBar.find(a=>a.id==='special').name,'Rasengan');
 assert.equal(abilityBar.find(a=>a.id==='secondary').name,'Shadow Clone Dash');
 assert.equal(abilityBar.find(a=>a.id==='secondary').key,'S + K');
 console.log('Browser ability bar checks passed.');
 const overlay=await evaluate(`(()=>{const frame=document.querySelector('.game-frame'),rect=frame.getBoundingClientRect(),abilities=document.querySelector('#abilities').getBoundingClientRect(),meter=document.querySelector('#player-stamina');return {inArena:frame.contains(meter)&&frame.contains(document.querySelector('#abilities')),width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,buttons:document.querySelectorAll('button.ability-card').length,abilityBottom:abilities.bottom,stamina:meter.value};})()`);
 assert.ok(overlay.inArena);assert.equal(overlay.buttons,6);
 assert.ok(overlay.width>=overlay.viewportWidth-2&&overlay.height>=overlay.viewportHeight-2,'Arena screen fills viewport');
 assert.ok(overlay.abilityBottom<=overlay.viewportHeight,'Ability buttons remain inside the screen');
 await evaluate("document.querySelector('[data-ability=basic]').click()");
 await new Promise(resolve=>setTimeout(resolve,120));
 const clicked=await evaluate("({state:document.querySelector('[data-ability=basic]').dataset.state,stamina:document.querySelector('#player-stamina').value})");
 assert.equal(clicked.state,'cooling','Clicking an ability activates it');
 assert.ok(clicked.stamina<overlay.stamina,'Stamina bar responds to ability cost');
 // Check portrait and short landscape without changing the world/canvas dimensions.
 for(const [width,height] of [[390,844],[844,390]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},sessionId);
  const layout=await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.ability-card')].map(b=>b.getBoundingClientRect());return {fits:buttons.every(r=>r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight),world:[document.querySelector('#arena').width,document.querySelector('#arena').height],scroll:document.documentElement.scrollWidth<=innerWidth};})()`);
  assert.ok(layout.fits&&layout.scroll,`Controls fit ${width}x${height}`);
  assert.deepEqual(layout.world,[1200,720],'Screen resizing does not enlarge the game world');
 }
 await call('Emulation.clearDeviceMetricsOverride',{},sessionId);
 console.log('Arena overlay, clickable abilities, stamina, responsive sizing, and unchanged world dimensions passed.');


 if(process.env.DIAGNOSE_LAG){
  await evaluate(`document.querySelector('#exit').click();document.querySelector('#confirm-exit').click();document.querySelector('#host').click();`);
  await evaluate(`window.inputPackets=[];window.receivedStates=[];window.measureInputs=false;
   window.NativeSocket=window.WebSocket;
   window.WebSocket=class extends NativeSocket{
    constructor(...args){super(...args);this.addEventListener('message',e=>{const state=JSON.parse(e.data);if(window.measureInputs&&state.type==='state')window.receivedStates.push({at:performance.now(),state});});}
    send(data){const message=JSON.parse(data);if(window.measureInputs&&message.type==='input')window.inputPackets.push({at:performance.now(),...message});setTimeout(()=>{if(this.readyState===1)super.send(data);},100);}
    set onmessage(handler){super.onmessage=e=>setTimeout(()=>handler(e),100);}
   };
   document.querySelector('#enter').click();`);
  const until=async(expression,timeout=10000)=>{const end=Date.now()+timeout;while(!await evaluate(expression)){assert.ok(Date.now()<end,'Timed out: '+expression);await new Promise(r=>setTimeout(r,50));}};
  await until("!!document.querySelector('.room-code')");
  await evaluate(`(async()=>{const result=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Luffy',code:document.querySelector('.room-code').textContent})}).then(r=>r.json());window.guestId=result.id;window.guestSocket=new NativeSocket('ws://localhost:3107/ws');guestSocket.onopen=()=>guestSocket.send(JSON.stringify({type:'auth',token:result.token}));})()`);
  await until("!document.querySelector('#start-party').disabled");
  await evaluate("document.querySelector('#start-party').click()");
  await until("!document.querySelector('#game').hidden&&document.querySelector('#game-message').textContent===''");
  await evaluate(`window.inputPackets=[];window.receivedStates=[];window.playerDraws=[];window.measureInputs=true;window.inputStarted=performance.now();window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}));window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyJ'}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyJ'}));setTimeout(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD'})),180);`);
  await new Promise(resolve=>setTimeout(resolve,1200));
  const report=await evaluate(`(()=>{const packets=window.inputPackets,states=window.receivedStates;return {simulatedRoundTripDelayMs:200,inputPackets:packets.length,meanInputIntervalMs:(packets.at(-1).at-packets[0].at)/(packets.length-1),quickAttackSent:packets.some(p=>p.commands.some(c=>c.input.presses.basic)),quickAttackOnServer:states.some(s=>s.state.game.players.some(p=>p.id!==window.guestId&&p.attack)),predictedMovementBeforeReply:window.playerDraws.filter(p=>p.at-window.inputStarted<90).some((p,i,draws)=>i>0&&p.x>draws[0].x+1)};})()`);
  console.log('Multiplayer latency regression:',JSON.stringify(report,null,2));
  assert.ok(report.meanInputIntervalMs<70,'Input cadence must not wait for round-trip responses');
  assert.ok(report.quickAttackSent&&report.quickAttackOnServer,'A press and release within one browser task reaches the server');
  assert.ok(report.predictedMovementBeforeReply,'Movement renders before a server response can arrive');
  assert.deepEqual(errors,[]);
  await evaluate("window.guestSocket.close();document.querySelector('#exit').click();document.querySelector('#confirm-exit').click()");
 }


} finally {if(browser){browser.kill();await new Promise(resolve=>browser.once('exit',resolve));}server.kill();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
