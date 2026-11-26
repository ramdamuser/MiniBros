# MiniBros

A playable browser platform-fighter prototype based on the supplied design document. Built with Canvas 2D, native browser modules, and a Node HTTP/WebSocket server using `ws`.

## Run

Requires Node.js 16 or newer (a maintained Node release is recommended).

```sh
npm ci
npm start
```

Open http://localhost:3000. To play with friends on your network, each player opens `http://<host-computer-LAN-IP>:3000`. Create a party, share its six-character room code, and start once two or more players have joined. The server listens on all interfaces; your firewall must permit the connection. A room code only works on the server that created it. Internet play requires hosting this server. After updating the source on Render, redeploy the service and refresh all players’ browsers together. The new multiplayer client requires the new WebSocket server.

## Play

- A / D: move; W / S: select up / down attacks.
- Space: jump; press again for a double jump.
- J: basic attack; K: special. Hold a direction to vary attacks.
- L: 140 ms parry window; hold to block.
- Left Shift: dash.
- Down + K: Shadow Clone Dash / Gum-Gum Balloon / Liver Blow.
- Up + K: recovery special.

The left stick or D-pad moves and selects attack direction. Default controller button indices: jump 0, basic 2, special 3, parry 4, dash 5. Settings supports keyboard and controller rebinding and persists volume settings locally. On standard-layout controllers these generally correspond to A, X, Y, LB, RB. A basic touch control strip is also available on narrow screens; keyboard/controller gives access to the full directional moveset.

During a match the arena screen fills the browser viewport while retaining the same 1200 × 720 game-world dimensions. A live stamina bar and clickable ability buttons sit inside the arena. Click or tap to attack or dash; hold the parry button to block and release it to stop. Keyboard and controller controls continue to work. The ability buttons show your basic attack, both signature specials, up special, dash, and parry/block. It uses your current key bindings and balance values, including stamina costs and live cooldowns. All attacks share the same cooldown; dash and parry have no separate cooldown. Availability labels also show low stamina, stun, exhaustion, and knockouts. The basic attack name changes with the direction held. Hover an ability button to see its controller binding.

Reach zero stamina to become exhausted. Parry to negate a hit, stun the attacker, and regain stamina. Holding attack does not repeat it. Higher damage increases knockback. Leaving the arena eliminates a fighter for the round.

Singleplayer has three bot difficulties. Easy bots do not parry. Medium and Hard bots make one parry decision per incoming attack (12% / 28% chance), react after a delay, and wait at least 2.5 / 1.6 seconds between attempts. They cannot reactively parry during their own attack or while stunned or exhausted. First to two round wins wins the match. Rounds last 90 seconds; timeout ranks surviving players by KO score, then damage received. Exact ties trigger a 15-second sudden-death extension with at least 150% damage. In parties with more than two players, first-to-two can take more than three rounds.

## Balancing characters and abilities

Edit **`public/balance.js`**. This is the single source of combat tuning used by singleplayer, the multiplayer server, and client prediction. The current values preserve the previous balance. `public/engine.js` is now formatted into separate movement, attack, defense, physics, and round-handling functions; ordinary number changes do not require editing it.

| Config section | What to change |
| --- | --- |
| `movement` | Gravity, acceleration, jump speed/count, dash speed/duration/cost, dash invulnerability |
| `stamina` | Maximum stamina, regeneration, exhaustion duration |
| `defense` | Parry timing/cost/reward/stun, block drain and movement penalty |
| `attacks.common` | Hit timing, hitbox ranges, hitstun, block stamina damage, knockback formula |
| `attacks.basic` | Universal basic attack damage/cost/cooldown and directional variants |
| `attacks.special` | Fallback special values and shared directional/recovery behavior |
| `fighters.Naruto`, `fighters.Luffy`, `fighters.Ippo` | Speed, weight, reach, damage multiplier, and character-specific overrides |
| `fighters.<name>.specials.<ability>` | Each named special's numbers and effects |
| `bots` | Bot attack frequency, parry probability, reaction time and parry cooldown |

The six specials have separate blocks: `rasengan`, `shadowCloneDash`, `gumGumPistol`, `gumGumBalloon`, `dempseyRoll`, and `liverBlow`. Each character's `specialInputs` maps neutral/side/up/down to a block. All abilities accept the fields listed in `attacks.common` as well as `damage`, `reach`, `staminaCost`, and `cooldown`.

For example, edit Naruto's existing `rasengan` block to reduce damage and cost and increase its cooldown:

```js
rasengan: {
  name: 'Rasengan',
  damage: 12,
  reach: 105,
  staminaCost: 25,
  cooldown: 0.8,
  dashSpeed: 600,
  dashDuration: 0.16,
  airborne: { damage: 10 },
  directions: {
    up: { recoverySpeed: 650 },
  },
},
```

To change only Ippo's side basic attack, replace his empty `basic: {}` block:

```js
basic: {
  directions: {
    side: {
      damage: 13,
      cooldown: 0.45,
      airborne: { verticalKnockback: -0.7 },
    },
  },
},
```

Values merge in this order: **common → basic/special defaults → character move**. Within each layer, the grounded/airborne override applies, followed by the direction override, then that direction's grounded/airborne override. Later values win. An explicit value in a named special overrides the shared special default; remove that field to inherit it instead. Character `movement`, `stamina`, and `defense` blocks similarly override their shared sections.

Use seconds for durations, world pixels for reach, pixels/second for speeds, and stamina points for costs. Gravity uses pixels/second². Damage is added to the opponent's percentage after multiplying by the attacker's `power`. `weight` divides incoming knockback. Horizontal force is `(knockbackBase + victimDamageAfterHit * knockbackPerDamage) * knockbackMultiplier / victimWeight`; `verticalKnockback` scales that force, with negative values launching upward and positive values downward.

`windup` is the delay before a **single hit check**, not a repeated damage interval. `animationDuration` includes windup and should be at least as long. `cooldown` starts at attack initiation. Keep weight, stamina maximum, and damage multipliers positive; use nonnegative costs, times, reach, and speed magnitudes. `reach: null` uses the character's basic reach, with `reachBonus` added afterward. Zero disables a cost or timed effect. `staminaDamage` drains stamina on unblocked hits; `blockStaminaDamage` drains it on blocked hits. The existing direct-hit stamina drain behavior is preserved; it does not independently trigger exhaustion.

After changes, restart the Node server, refresh all browsers, and start a new match. For Render, commit and deploy `public/balance.js` together with the updated engine, UI, and server route, then refresh both players. Server and client must use the same config for prediction to stay consistent. Run `npm test`; the tests in `test/balance.mjs` exercise config changes and restore the originals afterward.

## Verification

```sh
npm test
# With npm start running in another terminal:
node test/rooms.mjs
# macOS with Google Chrome installed (starts its own temporary server):
node test/browser.mjs
DENY_GAMEPAD=1 node test/browser.mjs
# Verify multiplayer with 100 ms delay each way (200 ms round trip):
DIAGNOSE_LAG=1 node test/browser.mjs
```

Combat checks cover jump limits, attack repeat prevention, parries, blocking, stamina exhaustion, round/match transitions, and timer tie handling. Netcode checks cover press-edge retention, command deduplication, prediction/reconciliation, remote interpolation, match resets, and elimination. Integration checks cover HTTP serving, party creation/join, capacity, host authority, WebSocket authentication, snapshots, authoritative quick-tap handling, reconnect, and stale-match input. The delayed browser test asserts that input delivery does not wait for replies, quick taps reach the server, and movement is visible before an authoritative reply arrives.

## Implementation and prototype limits

- `public/balance.js`: documented combat defaults, fighter stats, named special moves, and directional/aerial overrides.
- `public/engine.js`: formatted shared fixed-step combat simulation and bot decisions.
- `public/app.js`: lobby, settings, procedural sprite/arena renderer, audio, inputs, and network client.
- `server.mjs`: authoritative party simulation at 60 Hz and snapshots at 20 Hz over authenticated WebSockets. HTTP is used only for room actions and static files.
- `public/multiplayer.js`: WebSocket lifecycle, heartbeat/reconnect, and sequenced input batches sent at approximately 30 Hz, with control changes sent on the next simulation frame.
- `public/netcode.js`: bounded server input queue, local prediction/reconciliation, and remote interpolation.
- `public/style.css`: responsive lobby and game UI.

This is an initial playable implementation, not the finished asset or competitive networking pipeline. Art uses original procedural pixel shapes and animation rather than finished 4–10-frame sprite sheets. Specials approximate the described abilities; Dempsey Roll is a dash strike rather than a full weaving multi-hit animation, and there are no projectiles to deflect yet. Combat uses simple range checks; a production fighter needs animation-specific hitboxes, tuning, and playtesting. Rendering uses Canvas 2D, not WebGL/PixiJS/Phaser. Fonts load from Google Fonts with local fallbacks.

Multiplayer predicts your own movement and attack animations immediately, then replays unacknowledged inputs against each authoritative server update. Small position corrections blend out; knockouts and match resets apply immediately. Other players are interpolated through a 100 ms snapshot buffer. Press events are preserved separately from held buttons, and the server consumes each sequence only once. Simulation timing tracks elapsed time, with bounded catch-up after a short stall. After network jitter, the server skips stale movement commands beyond a three-frame queue cushion while retaining every action press in order with its original direction. This can cause a prediction correction after a stall, but avoids a permanent movement backlog without speeding up the simulation. Static arena scenery is cached per theme; clouds, particles, and fighters still animate each frame.

Hits, damage, parry outcomes, knockouts, and scores remain authoritative. This is not rollback combat: high network latency still affects hit confirmation and parry timing, and prediction may visibly correct after collisions. A nearby server region remains important. There are no accounts, persistent rooms, or production abuse controls. Keep one server instance because rooms are stored in memory.

Disconnecting a socket immediately clears held input. A client that stops sending inputs for one second is neutralized; inactive sessions expire after 15 seconds. The client reconnects automatically while its session still exists, clears obsolete input, and resumes from the last acknowledged sequence. A departing host transfers host status. Closing a local match's dialog resumes simulation; multiplayer continues while dialogs are open.

Render configuration remains a Node Web Service with build command `npm ci` (or `npm install`) and start command `npm start`. Include `package-lock.json` and both new browser modules when deploying. HTTPS pages automatically connect with `wss://` on the same host and port; no additional port or environment variable is needed. A deploy restarts the in-memory server and ends existing rooms.

Audio is synthesized, with separate master, SFX, and music gains. Browser audio starts after the first pointer interaction. Headless Chrome checks cover singleplayer launch, arena rendering, countdown progression, keyboard movement, and parry rendering, including when browser policy blocks controller access. Visual polish, actual gamepad hardware, and cross-device latency testing still require manual verification.
# MiniBros
