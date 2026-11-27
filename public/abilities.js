import {getMove, getFighterTuning} from './balance.js';

const keyLabel = code => code.replace('Key', '').replace('Digit', '').replace('Arrow', '').replace('Left', '');
const seconds = value => `${Math.max(0.1, Math.ceil(value * 10) / 10).toFixed(1)}s`;

// This reads the same resolved moves and live timers as the simulation.
export function abilityStates(game, playerId, controls, settings) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return [];
  const tuning = getFighterTuning(player.name);
  const direction = controls.up ? 'up' : controls.down ? 'down'
    : controls.left || controls.right ? 'side' : 'neutral';
  const side = controls.left || controls.right ? 'side' : 'neutral';
  const key = action => keyLabel(settings.keys[action]);
  const pad = action => `Pad ${settings.pad[action]}`;
  const attack = (id, special, kind, label, binding, controller) => {
    const move = getMove(player.name, special, kind, !player.ground);
    return {id, name: label || move.name, binding, controller, cost: move.staminaCost,
      cooldown: move.cooldown, remaining: player.cool, attack: true,
      detail: special ? move.name : `Direction: ${kind} · ${player.ground ? 'grounded' : 'airborne'}`};
  };
  const abilities = [
    attack('basic', false, direction, null, key('basic'), pad('basic')),
    attack('special', true, side, null, key('special'), pad('special')),
    attack('secondary', true, 'down', null, `${key('down')} + ${key('special')}`, `Down + ${pad('special')}`),
    attack('recovery', true, 'up', 'Up Special / Recovery', `${key('up')} + ${key('special')}`, `Up + ${pad('special')}`),
    {id: 'dash', name: 'Dash', binding: key('dash'), controller: pad('dash'), cost: tuning.movement.dashStaminaCost,
      cooldown: 0, remaining: 0, detail: 'Burst movement'},
    {id: 'parry', name: 'Parry / Block', binding: key('parry'), controller: pad('parry'), cost: tuning.defense.parryStaminaCost,
      cooldown: 0, remaining: 0, detail: `Hold: ${tuning.defense.blockDrainPerSecond} stamina/s`},
  ];
  for (const ability of abilities) {
    ability.state = 'ready';
    ability.status = 'Ready';
    if (!player.alive) { ability.state = 'unavailable'; ability.status = 'Knocked out'; }
    else if (game.phase !== 'fight') { ability.state = 'unavailable'; ability.status = game.phase === 'countdown' ? 'Get ready' : 'Round ended'; }
    else if (player.exhaust > 0) { ability.state = 'unavailable'; ability.status = `Exhausted ${seconds(player.exhaust)}`; }
    else if (player.stun > 0) { ability.state = 'unavailable'; ability.status = `Stunned ${seconds(player.stun)}`; }
    else if (ability.remaining > 0) { ability.state = 'cooling'; ability.status = seconds(ability.remaining); }
    else if (player.stamina < ability.cost) { ability.state = 'unavailable'; ability.status = 'Low stamina'; }
    else if (ability.id === 'parry' && player.guard) { ability.state = 'active'; ability.status = player.parry > 0 ? 'Parry window' : 'Blocking'; }
    else if (ability.id === 'dash' && player.dash > 0) { ability.state = 'active'; ability.status = 'Dashing'; }
  }
  return abilities;
}

export class AbilityBar {
  constructor(root, onPress = () => {}, onRelease = () => {}) {
    this.root = root;
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.cards = new Map();
  }

  update(game, playerId, controls, settings) {
    const abilities = abilityStates(game, playerId, controls, settings);
    for (const ability of abilities) {
      let card = this.cards.get(ability.id);
      if (!card) {
        card = document.createElement('button');
        card.type = 'button';
        card.className = 'ability-card';
        card.dataset.ability = ability.id;
        card.innerHTML = '<div class="ability-top"><kbd></kbd><span class="ability-status"></span></div><strong class="ability-name"></strong><span class="ability-detail"></span><span class="ability-cost"></span>';
        card.addEventListener('pointerdown', event => {
          if (event.button !== 0 || card.getAttribute('aria-disabled') === 'true') return;
          event.preventDefault();
          card.setPointerCapture(event.pointerId);
          this.onPress(ability.id);
        });
        const release = () => this.onRelease(ability.id);
        card.addEventListener('pointerup', release);
        card.addEventListener('pointercancel', release);
        card.addEventListener('lostpointercapture', release);
        // Native keyboard/assistive-tech activation has no pointerdown event.
        card.addEventListener('click', event => {
          if (event.detail === 0 && card.getAttribute('aria-disabled') !== 'true') {
            this.onPress(ability.id);
            this.onRelease(ability.id);
          }
        });
        this.cards.set(ability.id, card);
        this.root.append(card);
      }
      const setText = (selector, value) => {
        const element = card.querySelector(selector);
        if (element.textContent !== value) element.textContent = value;
      };
      card.dataset.state = ability.state;
      card.setAttribute('aria-disabled', String(!['ready', 'active'].includes(ability.state)));
      card.setAttribute('aria-label', `${ability.name}, ${ability.status}, ${ability.cost} stamina, ${ability.binding}`);
      setText('kbd', ability.binding);
      setText('.ability-name', ability.name);
      setText('.ability-detail', ability.detail);
      setText('.ability-cost', `${ability.cost} stamina · ${ability.cooldown ? `${ability.cooldown}s cooldown` : 'No cooldown'}`);
      setText('.ability-status', ability.status);
      card.title = `${ability.name} · ${ability.binding} / ${ability.controller}. ${ability.attack ? 'Shares the attack cooldown.' : ability.detail}`;
    }
  }
}
