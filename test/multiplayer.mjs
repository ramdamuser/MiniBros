import assert from 'node:assert/strict';
import {Multiplayer} from '../public/multiplayer.js';
import {FIXED_DT} from '../public/netcode.js';
// Exercise the real client update loop without a browser or a live connection.
const client=Object.create(Multiplayer.prototype),sent=[];
Object.assign(client,{ready:true,seq:0,generation:1,outbox:[],edges:{},lastHeld:{},accumulator:0,lastSend:0,
 view:{advance(){}},socket:{bufferedAmount:0,send:raw=>sent.push(JSON.parse(raw))}});
client.update({right:true},FIXED_DT,17);
assert.equal(sent.length,1,'Movement starts before the batch timer');
client.update({right:true},FIXED_DT,34);
assert.equal(sent.length,1,'Unchanged movement is batched');
client.update({},FIXED_DT,40);
assert.equal(sent.length,2,'Releases flush queued input before the batch timer');
assert.equal(sent[1].commands.at(-1).input.right,false);
client.press('basic');
client.update({},FIXED_DT/2,48);
assert.equal(sent.length,2,'A press waits for an actual prediction tick');
client.update({},FIXED_DT/2,56);
assert.equal(sent.length,3,'Quick taps flush on the next simulation tick');
assert.equal(sent[2].commands[0].input.presses.basic,true);
client.update({},FIXED_DT,73);client.update({},FIXED_DT,90);
assert.equal(sent.at(-1).commands.some(c=>c.input.presses.basic),false,'Presses are not repeated');
assert.deepEqual(sent.flatMap(p=>p.commands.map(c=>c.seq)),[1,2,3,4,5,6]);
console.log('Multiplayer send checks passed: immediate starts, releases and taps; steady input batching.');
