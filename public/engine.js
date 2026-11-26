import { BALANCE, getFighterTuning, getMove } from './balance.js';

export const roster = BALANCE.fighters;

// Stage and match rules are separate from character/ability balance.
const PLATFORMS = [
  { x: 240, w: 720, y: 500 },
  { x: 380, w: 150, y: 355 },
  { x: 670, w: 150, y: 355 },
];
const TIMERS = ['cool', 'stun', 'exhaust', 'parry', 'dash', 'clone', 'balloon'];

export function fighter(name, id, x) {
  return {
    name, id, x,
    y: 430,
    vx: 0,
    vy: 0,
    face: x < 600 ? 1 : -1,
    damage: 0,
    stamina: getFighterTuning(name).stamina.maximum,
    jumps: 0,
    ground: true,
    alive: true,
    wins: 0,
    kos: 0,
    received: 0,
    cool: 0,
    stun: 0,
    exhaust: 0,
    parry: 0,
    guard: false,
    dash: 0,
    clone: 0,
    balloon: 0,
    attack: null,
    prev: {},
  };
}

function spawnPlayers(players, keepWins = false) {
  return players.map((player, index) => ({
    ...fighter(player.name, player.id, 400 + index * 400 / Math.max(1, players.length - 1)),
    ...(keepWins ? { wins: player.wins } : {}),
    bot: player.bot,
  }));
}

export function match(players, theme = 'day', difficulty = 'Medium') {
  return {
    players: spawnPlayers(players),
    theme,
    difficulty,
    phase: 'countdown',
    clock: 3,
    time: 90,
    round: 1,
    effects: [],
    message: 'GET READY',
    winner: null,
  };
}

function resetRound(state) {
  state.players = spawnPlayers(state.players, true);
  state.round++;
  state.time = 90;
  state.phase = 'countdown';
  state.clock = 3;
  state.message = 'GET READY';
}

const botDefense = new WeakMap();

export function botInput(player, state, dt) {
  const target = state.players
    .filter(other => other.alive && other.id !== player.id)
    .sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
  if (!target) return {};

  const distance = target.x - player.x;
  const profile = BALANCE.bots[state.difficulty] || BALANCE.bots.Medium;
  let defense = botDefense.get(player);
  if (!defense) {
    defense = { attack: null, cooldown: 0, reaction: 0, pending: false };
    botDefense.set(player, defense);
  }
  defense.cooldown = Math.max(0, defense.cooldown - dt);
  let parry = false;
  const canDefend = Math.abs(distance) < 140
    && Math.abs(target.y - player.y) < 85
    && player.stamina >= 25
    && !player.stun && !player.exhaust && !player.attack;

  if (target.attack !== defense.attack) {
    defense.attack = target.attack;
    // Roll once per attack, not once per simulation frame.
    defense.pending = !!target.attack && !target.attack.hit && canDefend
      && defense.cooldown === 0 && Math.random() < profile.parryChance;
    defense.reaction = profile.reaction + Math.random() * profile.jitter;
  } else if (defense.pending) {
    defense.reaction -= dt;
    if (!canDefend || !target.attack || target.attack.hit) {
      defense.pending = false;
    } else if (defense.reaction <= 0) {
      parry = true;
      defense.pending = false;
      defense.cooldown = profile.cooldown;
    }
  }

  return {
    left: (distance < -55 && player.x > 280) || player.x > 950,
    right: (distance > 55 && player.x < 920) || player.x < 250,
    jump: (!player.ground && player.y > 450)
      || target.y < player.y - 65 && Math.random() < dt * 3,
    basic: Math.abs(distance) < 100 && Math.random() < dt * profile.rate,
    special: Math.abs(distance) < 180 && player.stamina > 40
      && Math.random() < dt * profile.rate * 0.35,
    parry,
    up: player.y > 480,
    down: Math.random() < 0.08,
  };
}

function spendStamina(player, amount, tuning) {
  if (amount <= 0) return;
  player.stamina = Math.max(0, player.stamina - amount);
  if (!player.stamina) {
    player.exhaust = tuning.stamina.exhaustionDuration;
    player.guard = false;
  }
}

function startAttack(player, input, pressed, direction, tuning) {
  if (player.cool || !(pressed('basic') || pressed('special'))) return;

  const special = pressed('special');
  const kind = input.up ? 'up' : input.down ? 'down' : direction ? 'side' : 'neutral';
  const air = !player.ground;
  const move = getMove(player.name, special, kind, air);
  if (player.stamina < move.staminaCost) return;

  if (move.staminaCost > 0) spendStamina(player, move.staminaCost, tuning);
  player.cool = move.cooldown;
  player.attack = { age: 0, hit: false, special, kind, air };

  // Specials are data-driven: no fighter-specific numbers or name checks here.
  if (move.dashDuration > 0) {
    player.dash = move.dashDuration;
    player.vx = player.face * move.dashSpeed;
  }
  if (move.cloneDuration > 0) player.clone = move.cloneDuration;
  if (move.balloonDuration > 0) {
    player.balloon = move.balloonDuration;
    player.balloonReflect = {
      horizontal: move.reflectHorizontalSpeed,
      upward: move.reflectUpwardSpeed,
    };
  }
  if (move.recoverySpeed > 0) player.vy = -move.recoverySpeed;
}

function updateActions(player, input, pressed, dt, tuning) {
  if (player.stun > 0 || player.exhaust > 0) return;

  const { movement, defense } = tuning;
  const direction = Number(!!input.right) - Number(!!input.left);
  if (direction) player.face = direction;
  if (!player.dash) {
    const desiredSpeed = direction * roster[player.name].speed
      * (player.guard ? defense.blockMovementMultiplier : 1);
    const acceleration = player.ground ? movement.groundAcceleration : movement.airAcceleration;
    player.vx += (desiredSpeed - player.vx) * Math.min(1, dt * acceleration);
  }

  if (pressed('jump') && player.jumps < movement.maxJumps) {
    player.vy = -movement.jumpSpeed;
    player.jumps++;
    player.ground = false;
  }
  if (pressed('parry') && player.stamina >= defense.parryStaminaCost) {
    player.parry = defense.parryWindow;
    spendStamina(player, defense.parryStaminaCost, tuning);
  }
  if (player.guard) spendStamina(player, dt * defense.blockDrainPerSecond, tuning);
  if (pressed('dash') && player.stamina >= movement.dashStaminaCost) {
    spendStamina(player, movement.dashStaminaCost, tuning);
    player.dash = movement.dashDuration;
    player.vx = player.face * movement.dashSpeed;
  }
  startAttack(player, input, pressed, direction, tuning);
}

function inRange(attacker, target, move) {
  return target.id !== attacker.id && target.alive
    && Math.abs(target.y - attacker.y) <= move.verticalReach
    && Math.abs(target.x - attacker.x) <= move.reach
    && (move.hitAllAround || (target.x - attacker.x) * attacker.face >= -move.rearReach);
}

function resolveHit(state, attacker, target, move, special) {
  const targetTuning = getFighterTuning(target.name);
  const { defense, stamina, movement } = targetTuning;

  if (target.parry > 0) {
    attacker.stun = defense.parryAttackerStun;
    target.stamina = Math.min(stamina.maximum, target.stamina + defense.parryStaminaReward);
    state.effects.push({ x: target.x, y: target.y - 30, text: 'PARRY', color: '#b7ff83', life: 0.65 });
    return;
  }
  if ((target.dash > 0 && movement.dashInvulnerable) || target.clone > 0) {
    target.clone = 0;
    return;
  }
  if (target.balloon > 0) {
    attacker.vx = -attacker.face * target.balloonReflect.horizontal;
    attacker.vy = -target.balloonReflect.upward;
    return;
  }
  if (target.guard && !move.bypassBlock) {
    spendStamina(target, move.blockStaminaDamage, targetTuning);
    return;
  }

  const damage = move.damage * roster[attacker.name].power;
  target.damage += damage;
  target.received += damage;
  target.lastHit = attacker.id;
  target.stun = move.hitstun;

  const force = (move.knockbackBase + target.damage * move.knockbackPerDamage)
    * move.knockbackMultiplier / roster[target.name].weight;
  target.vx = attacker.face * force;
  target.vy = force * move.verticalKnockback;
  target.ground = false;
  target.stamina = Math.max(0, target.stamina - move.staminaDamage);
  state.effects.push({
    x: target.x,
    y: target.y - 20,
    text: special ? move.name : 'HIT',
    color: roster[attacker.name].color,
    life: 0.5,
  });
}

function updateAttack(state, player, dt) {
  const attack = player.attack;
  if (!attack) return;
  const move = getMove(player.name, attack.special, attack.kind, attack.air);
  attack.age += dt;
  if (attack.age >= move.windup && !attack.hit) {
    attack.hit = true;
    for (const target of state.players) {
      if (inRange(player, target, move)) resolveHit(state, player, target, move, attack.special);
    }
  }
  if (attack.age > move.animationDuration) player.attack = null;
}

function updatePhysics(state, player, dt, movement, prediction) {
  const oldY = player.y;
  player.vy += movement.gravity * dt;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.ground = false;

  for (const platform of PLATFORMS) {
    if (player.vy >= 0 && oldY <= platform.y && player.y >= platform.y
      && player.x > platform.x - 12 && player.x < platform.x + platform.w + 12) {
      player.y = platform.y;
      player.vy = 0;
      player.ground = true;
      player.jumps = 0;
      break;
    }
  }

  // Prediction never awards a knockout; the server makes that decision.
  if (!prediction && (player.y > 850 || player.x < -160 || player.x > 1360)) {
    player.alive = false;
    const killer = state.players.find(other => other.id === player.lastHit);
    if (killer) killer.kos++;
    state.effects.push({
      x: Math.max(40, Math.min(1160, player.x)),
      y: 620,
      text: 'KNOCKOUT',
      color: roster[player.name].color,
      life: 1,
    });
  }
}

function finishRoundIfNeeded(state) {
  // Most ticks cannot end a round; avoid allocating a contender array then.
  let aliveCount = 0;
  for (const player of state.players) if (player.alive) aliveCount++;
  if (aliveCount > 1 && state.time > 0) return;
  const alive = state.players.filter(player => player.alive);
  if (alive.length > 1 && state.time > 0) return;

  const ranked = alive.length === 1 ? alive : [...alive].sort((a, b) => b.kos - a.kos || a.received - b.received);
  const winner = ranked[0];
  if (ranked.length > 1 && ranked[0].kos === ranked[1].kos && ranked[0].received === ranked[1].received) {
    state.time = 15;
    for (const player of alive) player.damage = Math.max(player.damage, 150);
    state.message = 'SUDDEN DEATH';
    return;
  }
  if (winner) winner.wins++;
  state.winner = winner?.id;
  state.message = winner ? `${winner.name.toUpperCase()} WINS THE ROUND` : 'DRAW';
  state.phase = winner?.wins >= 2 ? 'over' : 'round';
  state.clock = 3;
  if (state.phase === 'over') state.message = `${winner.name.toUpperCase()} TAKES THE MATCH`;
}

export function step(state, inputs, dt, prediction = false) {
  dt = Math.min(dt, 1 / 30);
  // Compact in place while retaining effect order and the exact lifetime rule.
  let effectsKept = 0;
  for (const effect of state.effects) if ((effect.life -= dt) > 0) state.effects[effectsKept++] = effect;
  state.effects.length = effectsKept;
  if (state.phase !== 'fight') {
    state.clock -= dt;
    if (state.phase === 'countdown' && state.clock <= 0) {
      state.phase = 'fight';
      state.message = '';
    } else if (state.phase === 'round' && state.clock <= 0) {
      resetRound(state);
    }
    return;
  }

  state.time -= dt;
  for (const player of state.players) {
    if (!player.alive) continue;
    const tuning = getFighterTuning(player.name);
    const input = player.bot ? botInput(player, state, dt) : inputs[player.id] || {};
    // Network commands carry explicit edges; local input derives them from held keys.
    const pressed = key => input.presses ? !!input.presses[key] : !!input[key] && !player.prev[key];
    for (const timer of TIMERS) player[timer] = Math.max(0, player[timer] - dt);
    player.guard = (!!input.parry || pressed('parry'))
      && player.stamina > 0 && player.stun === 0 && player.exhaust === 0;

    updateActions(player, input, pressed, dt, tuning);
    updateAttack(state, player, dt);
    updatePhysics(state, player, dt, tuning.movement, prediction);

    const regeneration = player.guard || player.exhaust ? 0 : tuning.stamina.regenerationPerSecond;
    player.stamina = Math.min(tuning.stamina.maximum, player.stamina + dt * regeneration);
    player.prev = { ...input };
  }

  if (!prediction) finishRoundIfNeeded(state);
}
