import assert from 'node:assert/strict';
import {SnapshotEncoder,SnapshotDecoder} from '../public/protocol.js';
import {match,step} from '../public/engine.js';
const encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
const room={code:'TEST',generation:1,players:[{id:'a',name:'Naruto'},{id:'b',name:'Luffy'}]};
room.game=match(room.players);room.game.phase='fight';
let fullBytes=0,deltaBytes=0;
for(let tick=0;tick<180;tick++){
 step(room.game,{a:{right:true},b:{}},1/60);
 if(tick===20)room.game.players[1].balloonReflect=true;
 if(tick===40)room.game.players[1].balloonReflect=false;
 if(tick%3)continue;
 const wire=encoder.encode(room,tick);
 const packet=decoder.decode(JSON.parse(wire.delta),tick);
 // Missing optional properties use null on the wire; all present values match.
 const expected=JSON.parse(JSON.stringify(room));
 for(const p of packet.game.players)for(const key of Object.keys(p))if(!(key in expected.game.players.find(q=>q.id===p.id)))delete p[key];
 assert.deepEqual(packet.game,expected.game);
 fullBytes+=wire.full.length;deltaBytes+=wire.delta.length;
}
const retained=JSON.stringify(decoder.values);
const skipped=encoder.encode(room,181);room.game.players[0].x+=10;
const next=encoder.encode(room,184);
assert.equal(decoder.decode(JSON.parse(next.delta),0),null,'Missing baseline requires resync');
assert.equal(JSON.stringify(decoder.values),retained,'Rejected delta cannot mutate history');
assert.ok(decoder.decode(JSON.parse(next.full),0),'Keyframe recovers after skipped send');
room.game=match(room.players);room.generation++;
const rematch=encoder.encode(room,187);
assert.equal(decoder.decode(JSON.parse(rematch.delta),0).generation,2);
assert.ok(deltaBytes<fullBytes*.7,'Movement deltas substantially reduce payload size');
console.log(`Protocol checks passed: fidelity, optional combat fields, baseline recovery, rematch; ${Math.round(100*(1-deltaBytes/fullBytes))}% fewer snapshot bytes in movement fixture.`);
