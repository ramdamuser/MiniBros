import assert from 'node:assert/strict';
import { BALANCE, getMove } from '../public/balance.js';
import { fighter, match, step } from '../public/engine.js';

const dt = 1 / 60;
function arena(name = 'Naruto', target = 'Ippo') {
  const state = match([{ name, id: 'a' }, { name: target, id: 'b' }]);
  state.phase = 'fight';
  state.players.forEach((p, i) => Object.assign(p, { x: 550 + i * 50, y: 500, ground: true }));
  return state;
}
function frames(state, inputs, count) {
  for (let n = 0; n < count; n++) step(state, inputs, dt);
}
function patch(object, values, run) {
  const saved = { ...object };
  Object.assign(object, values);
  try { run(); } finally {
    for (const key of Object.keys(object)) if (!(key in saved)) delete object[key];
    Object.assign(object, saved);
  }
}

// Changes to the shared move must actually affect collision and damage, not just labels.
patch(BALANCE.attacks.basic, { damage: 21, staminaCost: 8, cooldown: 0.9, windup: 0.2, animationDuration: 0.4 }, () => {
  const state = arena();
  frames(state, { a: { basic: true } }, 1);
  assert.equal(state.players[0].cool, 0.9);
  assert.ok(state.players[0].stamina < 93);
  frames(state, {}, 9);
  assert.equal(state.players[1].damage, 0, 'Custom windup delays the hit');
  frames(state, {}, 5);
  assert.equal(state.players[1].damage, 21, 'Shared basic damage reaches combat');
});
patch(BALANCE.attacks.basic, { reach: 20 }, () => {
  const state = arena();
  frames(state, { a: { basic: true } }, 8);
  assert.equal(state.players[1].damage, 0, 'Shorter configured reach can miss');
});

// Each named special can be changed independently of the other five.
for (const [name, character] of Object.entries(BALANCE.fighters)) {
  for (const [key, ability] of Object.entries(character.specials)) {
    const direction = Object.keys(character.specialInputs).find(d => character.specialInputs[d] === key);
    const beforeOther = getMove(name, true, direction === 'down' ? 'neutral' : 'down').damage;
    patch(ability, { damage: 29, staminaCost: 11, cooldown: 0.8, dashDuration: 0, hitstun: 0.7 }, () => {
      const state = arena(name, name === 'Ippo' ? 'Naruto' : 'Ippo');
      frames(state, { a: { special: true, down: direction === 'down' } }, 1);
      assert.equal(state.players[0].cool, 0.8);
      assert.ok(state.players[0].stamina > 88 && state.players[0].stamina < 90);
      frames(state, {}, 7);
      assert.equal(state.players[1].damage, 29 * character.power, `${key} damage uses its own tuning`);
      assert.ok(state.players[1].stun > 0.6);
      assert.equal(getMove(name, true, direction === 'down' ? 'neutral' : 'down').damage, beforeOther);
    });
  }
}

patch(BALANCE.fighters.Naruto.basic, {
  damage: 12,
  airborne: { damage: 17 },
  directions: { side: { damage: 19, airborne: { damage: 23 } } },
}, () => {
  assert.equal(getMove('Naruto', false, 'neutral', false).damage, 12);
  assert.equal(getMove('Naruto', false, 'neutral', true).damage, 17);
  assert.equal(getMove('Naruto', false, 'side', false).damage, 19);
  assert.equal(getMove('Naruto', false, 'side', true).damage, 23);
  assert.equal(getMove('Luffy', false, 'side', true).damage, 10);
});
patch(BALANCE.fighters.Naruto.movement, { jumpSpeed: 720, maxJumps: 1 }, () => {
  const state = arena();
  step(state, { a: { jump: true } }, dt);
  assert.equal(state.players[0].vy, -720 + BALANCE.movement.gravity * dt);
  step(state, {}, dt);
  step(state, { a: { jump: true } }, dt);
  assert.equal(state.players[0].jumps, 1);
});
patch(BALANCE.fighters.Naruto.stamina, { maximum: 150, regenerationPerSecond: 60 }, () => {
  assert.equal(fighter('Naruto', 'a', 550).stamina, 150);
  assert.equal(fighter('Luffy', 'b', 600).stamina, 100);
  const state = arena();state.players[0].stamina = 50;
  step(state, {}, dt);
  assert.equal(state.players[0].stamina, 51);
});
patch(BALANCE.fighters.Ippo.defense, { parryAttackerStun: 1.2 }, () => {
  const state = arena();
  frames(state, { a: { basic: true }, b: { parry: true } }, 7);
  assert.ok(state.players[0].stun > 1.1);
});
patch(BALANCE.fighters.Luffy.specials.gumGumBalloon, { reflectHorizontalSpeed: 321, reflectUpwardSpeed: 432 }, () => {
  const state = arena('Naruto', 'Luffy');
  step(state, { b: { special: true, down: true } }, dt);
  frames(state, { a: { basic: true } }, 7);
  assert.equal(state.players[0].vx, -321);
  assert.equal(state.players[0].vy, -432 + BALANCE.movement.gravity * dt);
});

console.log('Balance checks passed: shared attacks, all six specials, per-character and aerial overrides, movement, stamina, parries and balloon reflection.');
