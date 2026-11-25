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
 await evaluate(`window.playerDraws=[];const draw=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){if(text==='YOU')window.playerDraws.push({x,y});return draw.call(this,text,x,y,...rest)};window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'}));`);
 await new Promise(resolve=>setTimeout(resolve,250));
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyA'}));window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL'}))");
 await new Promise(resolve=>setTimeout(resolve,100));
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyL'}))");
 const positions=await evaluate('window.playerDraws');
 assert.ok(positions.length>2,'Animation continues during keyboard input');
 assert.ok(positions.at(-1).x<positions[0].x,'Keyboard movement works');
 assert.deepEqual(errors,[],'Movement and parry must render without exceptions');
 console.log('Singleplayer browser launch, countdown, keyboard movement, and parry passed.');
} finally {if(browser){browser.kill();await new Promise(resolve=>browser.once('exit',resolve));}server.kill();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
