import {step} from './engine.js';
export const FIXED_DT=1/60;
export const BUTTONS=['left','right','up','down','jump','basic','special','parry','dash'];
export const ACTIONS=['jump','basic','special','parry','dash'];
function copy(value){
 if(value===null||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(copy);
 const result={};for(const key in value)result[key]=copy(value[key]);return result;
}
export function cleanInput(input={}){
 const result={presses:{}};
 for(const key of BUTTONS)result[key]=input[key]===true;
 for(const key of ACTIONS)result.presses[key]=input.presses?.[key]===true;
 return result;
}
// A command is consumed once on an authoritative tick. Its held buttons persist,
// but its press edges never repeat while waiting for the next packet.
export class InputQueue {
 constructor(){this.reset();}
 reset(ack=0){this.queue=[];this.ack=ack;this.received=ack;this.held=cleanInput();this.idle=cleanInput();this.idle.presses={};}
 push(commands){
  if(!Array.isArray(commands)||commands.length>8)throw Error('Invalid input batch');
  for(const command of commands){
   if(!Number.isSafeInteger(command.seq)||command.seq<1)throw Error('Invalid input sequence');
   if(command.seq<=this.received)continue;
   if(this.queue.length>=120)throw Error('Input queue full');
   this.received=command.seq;
   this.queue.push({seq:command.seq,input:cleanInput(command.input)});
  }
 }
 next(){
  // A jitter burst must not leave movement permanently queued behind real time.
  // Keep a small batching cushion and every action's original direction/order.
  // The world still advances only once per server tick (no catch-up speed boost).
  while(this.queue.length>3&&!ACTIONS.some(key=>this.queue[0].input.presses[key])){
   this.ack=this.queue.shift().seq;
  }
  const command=this.queue.shift();
  if(!command)return this.idle;
  this.ack=command.seq;this.held=command.input;
  for(const key of BUTTONS)this.idle[key]=command.input[key];
  return command.input;
 }
}
// One reusable simulation context per view; combat remains authoritative.
function predict(view,input){
 const player=view.local;if(!player?.alive)return;
 const state=view.prediction;state.players[0]=player;state.effects.length=0;
 state.phase='fight';state.time=90;view.predictionInputs[player.id]=input;
 step(state,view.predictionInputs,FIXED_DT,true);
}
export class MatchView {
 constructor(id){this.id=id;this.reset();}
 reset(){this.game=null;this.local=null;this.history=[];this.pending=[];this.generation=null;this.offset={x:0,y:0};this.clockOffset=null;this.prediction={players:[],effects:[],phase:'fight',time:90};this.predictionInputs={};}
 receive(packet,now){
  const game=packet.game;
  if(!game){this.reset();return;}
  const changed=this.generation!==packet.generation||this.game?.round!==game.round||this.game?.phase!==game.phase;
  if(changed){this.pending=[];this.history=[];this.offset={x:0,y:0};}
  this.generation=packet.generation;this.game=game;
  // Use simulation timestamps, not irregular packet arrival intervals. The
  // minimum observed offset rejects positive network jitter; drift rises slowly.
  const serverTime=Number.isFinite(packet.tick)?packet.tick*FIXED_DT*1000:now;
  const sample=now-serverTime;
  if(changed||this.clockOffset===null)this.clockOffset=sample;
  else this.clockOffset=Math.min(sample,this.clockOffset+0.25);
  this.history.push({at:serverTime,game});if(this.history.length>12)this.history.shift();
  this.pending=this.pending.filter(c=>c.seq>packet.ack);
  const authoritative=game.players.find(p=>p.id===this.id);
  const previous=this.local;
  this.local=authoritative?copy(authoritative):null;
  if(game.phase==='fight')for(const command of this.pending)predict(this,command.input);
  if(previous&&this.local&&!changed&&previous.alive===this.local.alive){
   // Smooth small corrections; snap immediately on elimination or large divergence.
   const dx=previous.x+this.offset.x-this.local.x,dy=previous.y+this.offset.y-this.local.y;
   this.offset=Math.hypot(dx,dy)<100?{x:dx,y:dy}:{x:0,y:0};
  }else this.offset={x:0,y:0};
 }
 advance(command){
  if(this.game?.phase!=='fight')return;
  this.pending.push(command);
  if(this.pending.length>120)this.pending.shift();
  predict(this,command.input);
 }
 render(now,dt){
  if(!this.game)return null;
  const target=now-(this.clockOffset||0)-100;
  let older=this.history[0],newer=older;
  for(const frame of this.history){if(frame.at<=target)older=frame;if(frame.at>=target){newer=frame;break;}newer=frame;}
  const blend=newer.at>older.at?Math.max(0,Math.min(1,(target-older.at)/(newer.at-older.at))):1;
  this.offset.x*=Math.exp(-dt*18);this.offset.y*=Math.exp(-dt*18);
  return {...this.game,players:this.game.players.map(p=>{
   if(p.id===this.id&&this.local)return {...p,...this.local,damage:p.damage,wins:p.wins,alive:p.alive,x:this.local.x+this.offset.x,y:this.local.y+this.offset.y};
   const a=older.game.players.find(q=>q.id===p.id),b=newer.game.players.find(q=>q.id===p.id);
   if(!a||!b||a.alive!==b.alive||Math.hypot(a.x-b.x,a.y-b.y)>250)return p;
   return {...p,x:a.x+(b.x-a.x)*blend,y:a.y+(b.y-a.y)*blend};
  })};
 }
}
