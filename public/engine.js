export const roster = {
 Naruto: {color:'#ff9c46',hair:'#ffd551',speed:330,weight:1,reach:65,power:1,subtitle:'THE UNPREDICTABLE NINJA',specials:['Rasengan','Shadow Clone Dash']},
 Luffy: {color:'#ef5963',hair:'#242439',speed:290,weight:1.2,reach:95,power:1,subtitle:'THE RUBBER RENEGADE',specials:['Gum-Gum Pistol','Gum-Gum Balloon']},
 Ippo: {color:'#76b6ed',hair:'#242439',speed:320,weight:1.2,reach:52,power:1.35,subtitle:'THE FIGHTING SPIRIT',specials:['Dempsey Roll','Liver Blow']}
};
export function fighter(name,id,x){return {name,id,x,y:430,vx:0,vy:0,face:x<600?1:-1,damage:0,stamina:100,jumps:0,ground:true,alive:true,wins:0,kos:0,received:0,cool:0,stun:0,exhaust:0,parry:0,guard:false,dash:0,clone:0,balloon:0,attack:null,prev:{}};}
export function match(players,theme='day',difficulty='Medium'){return {players:players.map((p,i)=>({...fighter(p.name,p.id,400+i*400/Math.max(1,players.length-1)),bot:p.bot})),theme,difficulty,phase:'countdown',clock:3,time:90,round:1,effects:[],message:'GET READY',winner:null};}
function reset(s){s.players=s.players.map((p,i)=>({...fighter(p.name,p.id,400+i*400/Math.max(1,s.players.length-1)),wins:p.wins,bot:p.bot}));s.round++;s.time=90;s.phase='countdown';s.clock=3;s.message='GET READY';}
const botDefense = new WeakMap();
const botProfiles = {
 Easy: {rate:1.8, parryChance:0, reaction:.18, jitter:.10, cooldown:3},
 Medium: {rate:3.5, parryChance:.12, reaction:.08, jitter:.05, cooldown:2.5},
 Hard: {rate:6, parryChance:.28, reaction:.04, jitter:.05, cooldown:1.6}
};
export function botInput(p,s,dt){
 const target=s.players.filter(q=>q.alive&&q.id!==p.id).sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x))[0];
 if(!target)return {};
 const d=target.x-p.x,profile=botProfiles[s.difficulty]||botProfiles.Medium,rate=profile.rate;
 let defense=botDefense.get(p);
 if(!defense){defense={attack:null,cooldown:0,reaction:0,pending:false};botDefense.set(p,defense);}
 defense.cooldown=Math.max(0,defense.cooldown-dt);
 let parry=false;
 const canDefend=Math.abs(d)<140&&Math.abs(target.y-p.y)<85&&p.stamina>=25&&!p.stun&&!p.exhaust&&!p.attack;
 if(target.attack!==defense.attack){
  defense.attack=target.attack;
  // Roll only once per attack, rather than retrying every simulation frame.
  defense.pending=!!target.attack&&!target.attack.hit&&canDefend&&defense.cooldown===0&&Math.random()<profile.parryChance;
  defense.reaction=profile.reaction+Math.random()*profile.jitter;
 }else if(defense.pending){
  defense.reaction-=dt;
  if(!canDefend||!target.attack||target.attack.hit)defense.pending=false;
  else if(defense.reaction<=0){
   parry=true;
   defense.pending=false;
   defense.cooldown=profile.cooldown;
  }
 }
 return {left:(d<-55&&p.x>280)||p.x>950,right:(d>55&&p.x<920)||p.x<250,jump:(!p.ground&&p.y>450)||target.y<p.y-65&&Math.random()<dt*3,basic:Math.abs(d)<100&&Math.random()<dt*rate,special:Math.abs(d)<180&&p.stamina>40&&Math.random()<dt*rate*.35,parry,up:p.y>480,down:Math.random()<.08};
}
export function step(s,inputs,dt){dt=Math.min(dt,1/30);s.effects=s.effects.filter(e=>(e.life-=dt)>0);if(s.phase!=='fight'){s.clock-=dt;if(s.phase==='countdown'&&s.clock<=0){s.phase='fight';s.message='';}else if(s.phase==='round'&&s.clock<=0)reset(s);return;}
 s.time-=dt;
 for(const p of s.players){if(!p.alive)continue;const c=roster[p.name],i=p.bot?botInput(p,s,dt):inputs[p.id]||{};for(const k of ['cool','stun','exhaust','parry','dash','clone','balloon'])p[k]=Math.max(0,p[k]-dt);p.guard=!!i.parry&&p.stamina>0&&p.stun===0&&p.exhaust===0;
 const spend=n=>{p.stamina=Math.max(0,p.stamina-n);if(!p.stamina){p.exhaust=1.1;p.guard=false;}};
 if(p.stun===0&&p.exhaust===0){let dir=Number(!!i.right)-Number(!!i.left);if(dir)p.face=dir;if(!p.dash)p.vx+=(dir*c.speed*(p.guard?.25:1)-p.vx)*Math.min(1,dt*(p.ground?13:3));if(i.jump&&!p.prev.jump&&p.jumps<2){p.vy=-560;p.jumps++;p.ground=false;}
 if(i.parry&&!p.prev.parry&&p.stamina>=10){p.parry=.14;spend(10);}if(p.guard)spend(dt*15);
 if(i.dash&&!p.prev.dash&&p.stamina>=23){spend(23);p.dash=.18;p.vx=p.face*780;}
 if(!p.cool&&((i.basic&&!p.prev.basic)||(i.special&&!p.prev.special))){const special=!!i.special;if(!special||p.stamina>=30){if(special)spend(30);const kind=i.up?'up':i.down?'down':dir?'side':'neutral';p.cool=special?.65:.34;p.attack={age:0,hit:false,special,kind,air:!p.ground};if(special&&p.name==='Naruto'&&kind==='down'){p.clone=1.6;p.dash=.25;p.vx=p.face*650;}else if(special&&p.name==='Luffy'&&kind==='down')p.balloon=.55;else if(special&&p.name!=='Luffy'){p.vx=p.face*600;p.dash=.16;}if(special&&kind==='up')p.vy=-600;}}
 }
 if(p.attack){const a=p.attack;a.age+=dt;if(a.age>=.1&&!a.hit){a.hit=true;const reach=a.special?(p.name==='Luffy'?210:105):c.reach+(a.kind==='side'?15:0);for(const q of s.players){if(q.id===p.id||!q.alive||Math.abs(q.y-p.y)>85||Math.abs(q.x-p.x)>reach||((q.x-p.x)*p.face<-20&&a.kind!=='up'))continue;if(q.parry>0){p.stun=.65;q.stamina=Math.min(100,q.stamina+30);s.effects.push({x:q.x,y:q.y-30,text:'PARRY',color:'#b7ff83',life:.65});continue;}if(q.dash>0||q.clone>0){q.clone=0;continue;}if(q.balloon>0){p.vx=-p.face*600;p.vy=-260;continue;}const liver=a.special&&p.name==='Ippo'&&a.kind==='down';if(q.guard&&!liver){q.stamina=Math.max(0,q.stamina-23);if(!q.stamina){q.exhaust=1.1;q.guard=false;}continue;}const damage=(a.special?16:a.kind==='side'?10:a.kind==='down'?12:7)*c.power;q.damage+=damage;q.received+=damage;q.lastHit=p.id;q.stun=liver?.8:.2;const force=(260+q.damage*5)*(a.special?1.25:1)/roster[q.name].weight;q.vx=p.face*force;q.vy=a.kind==='up'?-force: a.kind==='down'&&a.air?force*.8:-force*.55;q.ground=false;if(liver)q.stamina=Math.max(0,q.stamina-40);s.effects.push({x:q.x,y:q.y-20,text:a.special?c.specials[a.kind==='down'?1:0]:'HIT',color:c.color,life:.5});}}if(a.age>.3)p.attack=null;}
 const oldY=p.y;p.vy+=1450*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.ground=false;
 for(const platform of [{x:240,w:720,y:500},{x:380,w:150,y:355},{x:670,w:150,y:355}]){if(p.vy>=0&&oldY<=platform.y&&p.y>=platform.y&&p.x>platform.x-12&&p.x<platform.x+platform.w+12){p.y=platform.y;p.vy=0;p.ground=true;p.jumps=0;break;}}
 if(p.y>850||p.x<-160||p.x>1360){p.alive=false;const killer=s.players.find(q=>q.id===p.lastHit);if(killer)killer.kos++;s.effects.push({x:Math.max(40,Math.min(1160,p.x)),y:620,text:'KNOCKOUT',color:c.color,life:1});}p.stamina=Math.min(100,p.stamina+dt*(p.guard||p.exhaust?0:19));p.prev={...i};}
 const alive=s.players.filter(p=>p.alive);if(alive.length<=1||s.time<=0){let winners=alive.length===1?alive:[...alive].sort((a,b)=>b.kos-a.kos||a.received-b.received);let winner=winners[0];if(winners.length>1&&winners[0].kos===winners[1].kos&&winners[0].received===winners[1].received){s.time=15;for(const p of alive)p.damage=Math.max(p.damage,150);s.message='SUDDEN DEATH';return;}if(winner)winner.wins++;s.winner=winner?.id;s.message=winner?`${winner.name.toUpperCase()} WINS THE ROUND`:'DRAW';s.phase=winner?.wins>=2?'over':'round';s.clock=3;if(s.phase==='over')s.message=`${winner.name.toUpperCase()} TAKES THE MATCH`;}
}
