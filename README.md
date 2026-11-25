# MiniBros

A playable browser platform-fighter prototype based on the supplied design document. Built with Canvas 2D, native browser modules, and a dependency-free Node HTTP server.

## Run

Requires Node.js 16 or newer (a maintained Node release is recommended).

```sh
npm start
```

Open http://localhost:3000. To play with friends on your network, each player opens `http://<host-computer-LAN-IP>:3000`. Create a party, share its six-character room code, and start once two or more players have joined. The server listens on all interfaces; your firewall must permit the connection. A room code only works on the server that created it. Internet play requires separately hosting this server; this project is not deployed.

## Play

- A / D: move; W / S: select up / down attacks.
- Space: jump; press again for a double jump.
- J: basic attack; K: special. Hold a direction to vary attacks.
- L: 140 ms parry window; hold to block.
- Left Shift: dash.
- Down + K: Shadow Clone Dash / Gum-Gum Balloon / Liver Blow.
- Up + K: recovery special.

The left stick or D-pad moves and selects attack direction. Default controller button indices: jump 0, basic 2, special 3, parry 4, dash 5. Settings supports keyboard and controller rebinding and persists volume settings locally. On standard-layout controllers these generally correspond to A, X, Y, LB, RB. A basic touch control strip is also available on narrow screens; keyboard/controller gives access to the full directional moveset.

Reach zero stamina to become exhausted. Parry to negate a hit, stun the attacker, and regain stamina. Holding attack does not repeat it. Higher damage increases knockback. Leaving the arena eliminates a fighter for the round.

Singleplayer has three bot difficulties. Easy bots do not parry. Medium and Hard bots make one parry decision per incoming attack (12% / 28% chance), react after a delay, and wait at least 2.5 / 1.6 seconds between attempts. They cannot reactively parry during their own attack or while stunned or exhausted. First to two round wins wins the match. Rounds last 90 seconds; timeout ranks surviving players by KO score, then damage received. Exact ties trigger a 15-second sudden-death extension with at least 150% damage. In parties with more than two players, first-to-two can take more than three rounds.

## Verification

```sh
npm test
# With npm start running in another terminal:
node test/rooms.mjs
# macOS with Google Chrome installed (starts its own temporary server):
node test/browser.mjs
DENY_GAMEPAD=1 node test/browser.mjs
```

Combat checks cover jump limits, attack repeat prevention, parries, blocking, stamina exhaustion, round/match transitions, and timer tie handling. Integration checks cover HTTP serving, party creation/join, capacity, host authority, session-token privacy, inputs, SSE snapshots, and room cleanup.

## Implementation and prototype limits

- `public/engine.js`: shared fixed-step combat simulation and bot decisions.
- `public/app.js`: lobby, settings, procedural sprite/arena renderer, audio, inputs, and network client.
- `server.mjs`: authoritative party simulation at 60 Hz, snapshots at 20 Hz via Server-Sent Events, and input POSTs.
- `public/style.css`: responsive lobby and game UI.

This is an initial playable implementation, not the finished asset or competitive networking pipeline. Art uses original procedural pixel shapes and animation rather than finished 4–10-frame sprite sheets. Specials approximate the described abilities; Dempsey Roll is a dash strike rather than a full weaving multi-hit animation, and there are no projectiles to deflect yet. Combat uses simple range checks; a production fighter needs animation-specific hitboxes, tuning, and playtesting. Rendering uses Canvas 2D, not WebGL/PixiJS/Phaser. Fonts load from Google Fonts with local fallbacks.

Multiplayer is suitable for prototype/LAN testing. It has no rollback, client prediction, latency compensation, accounts, persistent rooms, or production abuse controls. A client that stops sending inputs for one second is neutralized; inactive sessions expire after 15 seconds. Closing a tab relinquishes its slot after expiry. A departing host transfers host status. Closing a local match's dialog resumes simulation; multiplayer continues while dialogs are open.

Audio is synthesized, with separate master, SFX, and music gains. Browser audio starts after the first pointer interaction. Headless Chrome checks cover singleplayer launch, arena rendering, countdown progression, keyboard movement, and parry rendering, including when browser policy blocks controller access. Visual polish, actual gamepad hardware, and cross-device latency testing still require manual verification.
# MiniBros
