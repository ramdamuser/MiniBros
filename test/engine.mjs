import assert from 'node:assert/strict';
import {match,step} from '../public/engine.js';
const make=()=>{const s=match([{id:'a',name:'Naruto'},{id:'b',name:'Ippo'}]);s.phase='fight';s.players[0].x=550;s.players[1].x=600;for(const p of s.players){p.y=500;p.ground=true;}return s;};
const advance=(s,inputs={},n=1)=>{for(let i=0;i<n;i++)step(s,inputs,1/60);};
let s=make();advance(s,{a:{jump:true}});assert.equal(s.players[0].jumps,1);advance(s,{},2);advance(s,{a:{jump:true}});assert.equal(s.players[0].jumps,2);advance(s,{},2);advance(s,{a:{jump:true}});assert.equal(s.players[0].jumps,2);
s=make();advance(s,{a:{basic:true}},8);assert.ok(s.players[1].damage>0,'basic hit damages opponent');const damage=s.players[1].damage;advance(s,{a:{basic:true}},30);assert.equal(s.players[1].damage,damage,'holding attack does not auto spam');
s=make();advance(s,{a:{basic:true},b:{parry:true}},7);assert.equal(s.players[1].damage,0);assert.ok(s.players[0].stun>0,'parry stuns attacker');
s=make();s.players[1].prev.parry=true;advance(s,{a:{basic:true},b:{parry:true}},7);assert.equal(s.players[1].damage,0,'block absorbs damage');assert.ok(s.players[1].stamina<90,'block costs stamina');
s=make();s.players[0].stamina=30;advance(s,{a:{special:true}});assert.ok(s.players[0].stamina<1);assert.ok(s.players[0].exhaust>0);
s=make();s.players[1].y=900;advance(s);assert.equal(s.phase,'round');assert.equal(s.players[0].wins,1);advance(s,{},181);assert.equal(s.phase,'countdown');advance(s,{},181);s.players[1].y=900;advance(s);assert.equal(s.phase,'over');assert.equal(s.players[0].wins,2);
s=make();s.time=0;s.players[0].kos=1;advance(s);assert.equal(s.winner,'a','KO score resolves timer');
s=make();s.time=0;advance(s);assert.equal(s.phase,'fight');assert.ok(s.players.every(p=>p.damage===150),'tied timer starts sudden death');
s=make();s.time=0;s.players[0].received=15;advance(s);assert.equal(s.winner,'b','lower received damage breaks tied score');
console.log('Combat checks passed: jumps, attack repeat, parry, block, stamina, match wins, timer, sudden death.');

// A bot gets one defensive decision per wind-up, with reaction time and downtime.
const {botInput}=await import('../public/engine.js');
const random=Math.random;
try {
 Math.random=()=>0; // Force every eligible defensive decision to succeed.
 for(const difficulty of ['Easy','Medium','Hard']){
  const state=make();state.difficulty=difficulty;
  const [attacker,bot]=state.players;
  attacker.attack={age:0,hit:false};
  assert.equal(botInput(bot,state,1/60).parry,false,`${difficulty} cannot parry immediately`);
  let attempts=0;
  for(let frame=0;frame<20;frame++)attempts+=Number(botInput(bot,state,1/60).parry);
  assert.equal(attempts,difficulty==='Easy'?0:1,`${difficulty} attempts at most one parry per attack`);
  attacker.attack={age:0,hit:false};
  for(let frame=0;frame<20;frame++)assert.equal(botInput(bot,state,1/60).parry,false,'Follow-up attacks cannot trigger a cooldown parry');
 }
 const state=make();state.difficulty='Hard';const [attacker,bot]=state.players;
 attacker.attack={age:0,hit:false};
 Math.random=()=>.99;
 assert.equal(botInput(bot,state,1/60).parry,false);
 Math.random=()=>0;
 for(let frame=0;frame<30;frame++)assert.equal(botInput(bot,state,1/60).parry,false,'A missed decision cannot be rerolled every frame');
 // A declined defensive decision must leave bots open to a clean hit in real combat.
 Math.random=()=>.99;
 for(const difficulty of ['Easy','Medium']){
  const state=make();state.difficulty=difficulty;state.players[1].bot=true;state.players[1].cool=.5; // Isolate defense from special-move evasion.
  advance(state,{a:{basic:true}},8);
  assert.ok(state.players[1].damage>0,`${difficulty} bot takes damage from an in-range jab`);
 }
}finally{Math.random=random;}
console.log('Bot balance checks passed: reaction delay, one decision per attack, cooldown, and punishable Easy/Medium bots.');
