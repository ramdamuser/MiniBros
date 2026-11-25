/**
 * MINIBROS BALANCE CONFIG — edit this file to tune combat.
 *
 * Units: seconds, world pixels, pixels/second, stamina points, damage percentage.
 * Positive vertical velocity is DOWN; jump/recovery speeds are positive values
 * that the engine applies upward. Higher weight reduces incoming knockback.
 *
 * Moves inherit: attacks.common -> attacks.basic/special -> character move.
 * At each level, grounded/airborne and directions.neutral/side/up/down override
 * the base values. A direction can also contain grounded/airborne overrides.
 * Set a number to 0 to disable a cost/effect; omit it to inherit the default.
 * Restart the server and refresh browsers after edits (redeploy for online play).
 */
export const BALANCE = {
  // Shared movement. Character speed is configured in fighters below.
  movement: {
    gravity: 1450,             // pixels/second²
    groundAcceleration: 13,    // response rate toward desired running speed
    airAcceleration: 3,
    jumpSpeed: 560,
    maxJumps: 2,               // total jumps before landing
    dashSpeed: 780,
    dashDuration: 0.18,
    dashStaminaCost: 35,
    dashInvulnerable: true,    // also applies to specials using a dash
  },

  stamina: {
    maximum: 100,
    regenerationPerSecond: 10, // paused while blocking or exhausted
    exhaustionDuration: 1.1,
  },

  defense: {
    parryWindow: 0.14,
    parryStaminaCost: 10,
    parryStaminaReward: 30,
    parryAttackerStun: 0.65,
    blockDrainPerSecond: 15,
    blockMovementMultiplier: 0.25,
  },

  attacks: {
    // Shared by ALL basic and special moves unless overridden below.
    common: {
      windup: 0.10,             // one hit check occurs at this time
      animationDuration: 0.30,  // total move animation, including windup
      verticalReach: 85,        // maximum vertical separation for a hit
      rearReach: 20,            // small allowance behind the attacker
      hitAllAround: false,      // ignore facing when true
      hitstun: 0.20,
      blockStaminaDamage: 23,   // stamina removed when the hit is blocked
      staminaDamage: 0,         // extra stamina damage on an unblocked hit
      bypassBlock: false,       // does NOT bypass parries or invulnerability
      knockbackBase: 260,
      knockbackPerDamage: 5,    // uses victim's damage AFTER this hit
      knockbackMultiplier: 1,
      verticalKnockback: -0.55, // fraction of horizontal force; negative = up
      reachBonus: 0,
      dashSpeed: 0,
      dashDuration: 0,
      recoverySpeed: 0,
      cloneDuration: 0,
      balloonDuration: 0,
      reflectHorizontalSpeed: 0,
      reflectUpwardSpeed: 0,
    },

    // Universal J / basic attacks. null reach uses the character's reach stat.
    basic: {
      name: 'Jab',
      damage: 7,
      reach: null,
      staminaCost: 5,
      cooldown: 0.34,           // starts when the attack begins
      directions: {
        neutral: {},
        side: { name: 'Cross / Hook', damage: 10, reachBonus: 15 },
        up: { name: 'Upward strike', hitAllAround: true, verticalKnockback: -1 },
        down: {
          name: 'Kick',
          damage: 12,
          airborne: { verticalKnockback: 0.8 }, // downward aerial spike
        },
      },
      grounded: {},
      airborne: {},
    },

    // Defaults inherited by every signature special below.
    special: {
      damage: 16,
      reach: 105,
      staminaCost: 60,
      cooldown: 10,
      knockbackMultiplier: 1.25,
      directions: {
        neutral: {},
        side: {},
        up: { hitAllAround: true, verticalKnockback: -1, recoverySpeed: 600 },
        down: { airborne: { verticalKnockback: 0.8 } },
      },
      grounded: {},
      airborne: {},
    },
  },

  fighters: {
    Naruto: {
      color: '#ff9c46',
      hair: '#ffd551',
      subtitle: 'THE UNPREDICTABLE NINJA',
      speed: 150,
      weight: 1,               // divides incoming knockback
      reach: 65,               // base reach for basic attacks
      power: 1,                // multiplies outgoing damage, including specials
      movement: {},            // optional overrides of shared movement
      stamina: {},             // optional overrides of shared stamina
      defense: {},             // optional overrides of shared defense
      basic: {},               // optional overrides of attacks.basic
      specialInputs: {
        neutral: 'rasengan', side: 'rasengan', up: 'rasengan', down: 'shadowCloneDash',
      },
      specials: {
        rasengan: {
          name: 'Rasengan',
          damage: 16,
          reach: 105,
          staminaCost: 40,
          cooldown: 5,
          dashSpeed: 600,
          dashDuration: 0.16,
          // Example override: airborne: { damage: 18 }
        },
        shadowCloneDash: {
          name: 'Shadow Clone Dash',
          damage: 16,
          reach: 105,
          staminaCost: 30,
          cooldown: 5,
          dashSpeed: 650,
          dashDuration: 0.25,
          cloneDuration: 1.6,   // absorbs one hit while active
        },
      },
    },

    Luffy: {
      color: '#ef5963',
      hair: '#242439',
      subtitle: 'THE RUBBER RENEGADE',
      speed: 150,
      weight: 1.2,
      reach: 95,
      power: 1,
      movement: {},
      stamina: {},
      defense: {},
      basic: {},
      specialInputs: {
        neutral: 'gumGumPistol', side: 'gumGumPistol', up: 'gumGumPistol', down: 'gumGumBalloon',
      },
      specials: {
        gumGumPistol: {
          name: 'Gum-Gum Pistol',
          damage: 16,
          reach: 210,
          staminaCost: 60,
          cooldown: 5,
        },
        gumGumBalloon: {
          name: 'Gum-Gum Balloon',
          damage: 16,
          reach: 210,
          staminaCost: 30,
          cooldown: 5,
          balloonDuration: 0.55,
          reflectHorizontalSpeed: 600,
          reflectUpwardSpeed: 260,
        },
      },
    },

    Ippo: {
      color: '#76b6ed',
      hair: '#242439',
      subtitle: 'THE FIGHTING SPIRIT',
      speed: 150,
      weight: 1.2,
      reach: 52,
      power: 1.35,
      movement: {},
      stamina: {},
      defense: {},
      basic: {},
      specialInputs: {
        neutral: 'dempseyRoll', side: 'dempseyRoll', up: 'dempseyRoll', down: 'liverBlow',
      },
      specials: {
        dempseyRoll: {
          name: 'Dempsey Roll',
          damage: 16,
          reach: 105,
          staminaCost: 40,
          cooldown: 5,
          dashSpeed: 600,
          dashDuration: 0.16,
        },
        liverBlow: {
          name: 'Liver Blow',
          damage: 16,
          reach: 105,
          staminaCost: 50,
          cooldown: 0.65,
          dashSpeed: 600,
          dashDuration: 0.16,
          hitstun: 0.8,
          staminaDamage: 40,
          bypassBlock: true,
        },
      },
    },
  },

  // Bot tuning remains separate from the actual move statistics.
  bots: {
    Easy: { rate: 1.8, parryChance: 0, reaction: 0.18, jitter: 0.10, cooldown: 3 },
    Medium: { rate: 3.5, parryChance: 0.12, reaction: 0.08, jitter: 0.05, cooldown: 2.5 },
    Hard: { rate: 6, parryChance: 0.28, reaction: 0.04, jitter: 0.05, cooldown: 1.6 },
  },
};

// Resolvers are shared by the server, singleplayer and client prediction.
export function getFighterTuning(name) {
  const character = BALANCE.fighters[name];
  return {
    movement: { ...BALANCE.movement, ...character.movement },
    stamina: { ...BALANCE.stamina, ...character.stamina },
    defense: { ...BALANCE.defense, ...character.defense },
  };
}

function moveLayer(config, direction, state) {
  const directional = config.directions?.[direction] || {};
  return { ...config, ...config[state], ...directional, ...directional[state] };
}

export function getMove(name, special, direction = 'neutral', airborne = false) {
  const character = BALANCE.fighters[name];
  const state = airborne ? 'airborne' : 'grounded';
  const category = special ? BALANCE.attacks.special : BALANCE.attacks.basic;
  const ability = special
    ? character.specials[character.specialInputs[direction]]
    : character.basic;
  const move = {
    ...moveLayer(BALANCE.attacks.common, direction, state),
    ...moveLayer(category, direction, state),
    ...moveLayer(ability, direction, state),
  };
  move.reach = (move.reach ?? character.reach) + move.reachBonus;
  return move;
}
