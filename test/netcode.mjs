import assert from 'node:assert/strict';
import {match,step} from '../public/engine.js';
import {InputQueue,MatchView,cleanInput,FIXED_DT} from '../public/netcode.js';
const state=()=>{const game=match([{name:'Naruto',id:'a'},{name:'Luffy',id:'b'}]);game.phase='fight';game.players.forEach(p=>{p.y=500;p.ground=true;});return game;};
const queue=new InputQueue();
queue.push([{seq:1,input:{jump:false,presses:{jump:true}}},{seq:2,input:{}}]);
let game=state();step(game,{a:queue.next()},FIXED_DT);assert.equal(game.players[0].jumps,1,'A complete tap inside one packet still jumps');
step(game,{a:queue.next()},FIXED_DT);assert.equal(game.players[0].jumps,1);assert.equal(queue.ack,2);
queue.push([{seq:1,input:{presses:{jump:true}}}]);assert.equal(queue.queue.length,0,'Duplicates cannot replay attacks');
assert.equal(queue.next().presses.jump,undefined,'Held input must not repeat a press');
assert.throws(()=>queue.push([{seq:Infinity,input:{}}]));
queue.push([{seq:3,input:{right:true,presses:{dash:true}}}]);queue.next();assert.equal(queue.next().right,true);assert.deepEqual(queue.next().presses,{});
queue.reset(queue.ack);assert.equal(queue.next().right,false,'Disconnect/reset releases held buttons');

const view=new MatchView('a');game=state();view.receive({game,generation:1,ack:0},0);
const originalX=game.players[0].x;
const commands=Array.from({length:12},(_,i)=>({seq:i+1,input:cleanInput({right:true})}));
for(const command of commands)view.advance(command);
assert.ok(view.local.x>originalX,'Local movement predicts before any server reply');
assert.equal(game.players[0].x,originalX,'Prediction never changes authoritative state');
const predictedX=view.local.x;
const authoritative=state();for(const command of commands.slice(0,6))step(authoritative,{a:command.input},FIXED_DT);
view.receive({game:authoritative,generation:1,ack:6},100);
assert.equal(view.pending.length,6);assert.ok(Math.abs(view.local.x-predictedX)<.001,'Replaying unacknowledged inputs matches authoritative movement');
const next=state();next.players[1].x+=60;
const smooth=new MatchView('a');smooth.receive({game:state(),generation:1,ack:0},0);smooth.receive({game:next,generation:1,ack:0},50);
const remote=smooth.render(125,FIXED_DT).players[1];assert.equal(remote.x,830,'Remote interpolation fills the frames between snapshots');
view.receive({game:state(),generation:2,ack:12},200);assert.equal(view.pending.length,0);assert.equal(view.local.x,originalX,'Rematch clears prediction');
const knockout=state();knockout.players[0].alive=false;view.receive({game:knockout,generation:2,ack:12},250);assert.equal(view.render(250,FIXED_DT).players[0].alive,false,'Authoritative elimination is immediate');
console.log('Netcode checks passed: quick taps, ordering, deduplication, held input, prediction/replay, interpolation, rematches and knockouts.');

// Reproduce a 300 ms delivery stall followed by the normal 60 Hz stream.
const stalled=new InputQueue();
for(let seq=1;seq<=18;seq++)stalled.push([{seq,input:{right:true}}]);
stalled.next();
assert.equal(stalled.ack,16,'Stale movement is skipped on the first recovery tick');
for(let seq=19;seq<=78;seq++){
 stalled.push([{seq,input:{right:true}}]);stalled.next();
 assert.equal(stalled.queue.length,2,'The stream stays close to real time after jitter');
}
stalled.push([{seq:79,input:{right:false}}]);
for(let i=0;i<3;i++)stalled.next();
assert.equal(stalled.next().right,false,'Releasing movement is not stuck behind a stall');
const actions=new InputQueue();
for(let seq=1;seq<=12;seq++)actions.push([{seq,input:{
 left:seq===3,down:seq===7,
 presses:seq===3?{jump:true}:seq===7?{special:true}:seq===8?{jump:true}:{},
}}]);
const first=actions.next();assert.equal(actions.ack,3);assert.equal(first.left,true);assert.equal(first.presses.jump,true);
const second=actions.next();assert.equal(actions.ack,7);assert.equal(second.down,true);assert.equal(second.presses.special,true);
assert.equal(actions.next().presses.jump,true,'Separate presses remain separate during catch-up');
while(actions.queue.length)actions.next();
assert.equal(actions.ack,12);assert.deepEqual(actions.next().presses,{});
console.log('Jitter regression: 18 queued frames reduced to 2 after one tick; action order/direction retained.');

const jitterView=new MatchView('a');
const j0=state(),j1=state(),j2=state();j1.players[1].x+=60;j2.players[1].x+=120;
jitterView.receive({game:j0,generation:1,ack:0,tick:0},0);
jitterView.receive({game:j1,generation:1,ack:0,tick:3},90);
jitterView.receive({game:j2,generation:1,ack:0,tick:6},100);
assert.equal(jitterView.render(175,FIXED_DT).players[1].x,890,'Arrival jitter cannot distort simulation snapshot spacing');
console.log('Simulation timestamp interpolation regression passed.');
