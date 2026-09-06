# Context: the language of this codebase

Terms that carry a precise meaning here. Use them in code, comments, commits and
conversation; when a term stops fitting, change this file in the same change.

## Authority

**Hybrid authority.** Clients own their own movement; the server owns every
_outcome_. Rationale and rejected alternatives in
[ADR 0001](docs/adr/0001-hybrid-authority.md).

**Intent.** A client-to-server message asking for something that affects other
players or the world: `user:joined`, `weapon:shoot`, `grenade:throw`,
`pickup:claim`, `player:respawn`. The server may drop an intent (fire-rate
violation, throw cooldown, out of reach, already dead, room full). Nothing
changes in the world until the server says so.

**Outcome event.** A discrete server-to-client message stating that something
happened: `game:state`, `user:join-rejected`, `combat:hit`, `combat:kill`,
`player:respawn`, `crate:damaged`, `crate:destroyed`, `pickup:spawned`,
`pickup:taken`, `pickup:expired`, `grenade:exploded`, `match:phase`. Clients
apply outcomes without question, including to the local player (HP, death,
team, spawn position).

**Full sync.** `game:state { selfId, players, crates, pickups, match }`: the
authoritative state of the whole world, sent to one player. A joiner gets one
as the answer to `user:joined`; every player gets one on each round reset.
Client renderers treat it as "whatever the server lists is what exists": missing
crates are removed, listed crates come back, pickups are rebuilt, the local
player stands where its own entry says.

**Cosmetic.** Anything a client draws that has no bearing on game state. Client
bullets are cosmetic: they fly, stop at the first thing they touch and leave an
impact mark, but never deal damage. The server's rebroadcast of `weapon:shoot`
is also cosmetic; it exists so other clients can draw the same bullet.

## Teams

Two fixed sides, **blue** and **red**, `MAX_TEAM_SIZE` (5) players each.
Rationale and rejected alternatives in [ADR 0002](docs/adr/0002-teams.md).

**Team.** `shared/src/sim/teams.ts`. Assigned by the server on join to the side
with fewer players (blue on a tie), never chosen or switched by the player.
Travels on every `PlayerSnapshot` and `LeaderboardEntry`. A player who leaves
and re-joins is a new player: fresh balanced assignment, kills reset.

**Join rejection.** `user:joined` is an intent. When both teams are full the
server answers `user:join-rejected { reason: "room-full" }` and registers
nothing; the client's menu stays open and says so. `NetworkClient` stops
re-joining on reconnect after a rejection.

**Server-picked spawn.** The join payload carries only a name. The server
picks the initial spawn, like every respawn, from the player's own **spawn
zone** and the joiner learns where it stands from its own entry in
`game:state`. The local player is not in the world until that arrives.

**Spawn zone.** The spawn points that belong to one team: `SpawnPoint.team` in
the level schema and `MapLayout`. Blue owns the south spawn street, red the
north one. `spawnPointsFor(team, points)` filters; `pickSpawnPoint` never
crosses zones. A level must give every team at least one point (validator
error) and should give each exactly `MAX_TEAM_SIZE` (warning).

**Team score.** `GameRoom.teamScores: { blue, red }`, kills per team this
round. An independent counter, not a sum of the leaderboard rows, so a
leaver's kills stay on the board until the reset. Carried on every
`combat:kill`, in the `match` block of every snapshot, and in the
`/leaderboard` response as `teams`, next to the per-player `players`.

**Team kill.** Friendly fire is on. Killing a teammate costs the kill it would
have earned: killer `kills -= 1`, `score -= 100`, team score `-= 1`; the
victim's death still counts. Totals may go negative. `combat:kill.teamKill` is
`true` so the HUD can say so. Suicides and world hazards (cars) credit nobody
and are not team kills.

## Match pacing

One room, one **round** at a time, forever. The team with the most kills wins.
`shared/src/sim/match.ts` owns the rules and the state machine; `GameRoom`
steps it once per tick and carries out its transitions.

**Phase.** Where the round loop stands, one of four:

- **warmup**: free play with no clock, while a team has nobody on it. Kills
  count on the board but decide nothing.
- **countdown**: `COUNTDOWN_MS` (5 s) frozen at spawn. Position intents are
  ignored, combat is off. Entered from warmup the moment both teams have a
  player, and from round end.
- **active**: the round proper, `ROUND_MS` (8 min) or until a team reaches the
  **kill limit** (`KILL_LIMIT`, 30). A team emptying mid-round does not stop
  it.
- **round end**: `ROUND_END_MS` (8 s) of results. Combat is off (no shooting,
  throwing, claiming, damage, or pickup spawns); movement and respawning are
  allowed. Then countdown again, or warmup if a team is gone.

**Reset.** What happens on the way into countdown (and from round end into
warmup): team scores and every leaderboard row go to zero, projectiles,
grenades and pickups are cleared, every crate is rebuilt from the map, every
player stands alive with full HP on their spawn street, and each player gets a
full sync. Teams are kept; a player's team changes only by leaving and
re-joining.

**Round result.** `{ winner: "blue" | "red" | "draw", teamScores }`, decided
when the round ends: the team at the kill limit, otherwise the team with more
kills at the buzzer, otherwise a draw. Travels on `match:phase` when entering
round end, with the round's leaderboard rows, and in `game:state.match.result`
so a late joiner sees the board.

**Match block.** `match: { phase, phaseEndsAt, teamScores }` on every
snapshot, in `game:state` and in `/leaderboard`. `phaseEndsAt` is server time
(`null` in warmup); the client's **round clock** is `phaseEndsAt - serverTime`,
never a local timer. `match:phase` marks each transition for the UI moments
(countdown numerals, GO, the board); a client that missed it heals from the
next snapshot.

## Time

**Tick.** One step of the server simulation. `TICK_RATE` is 20 Hz
(`shared/src/types.ts`). All server physics (projectiles, grenades, car
contact) advance per tick with a fixed `dt`, independent of wall-clock jitter.

**Snapshot.** `world:snapshot { tick, serverTime, players, grenades, clouds, match }`,
broadcast once per tick. Carries continuous state only; discrete happenings go
through outcome events. Snapshots are full, not delta-compressed.

**Replication.** The client module (`app/src/net/Replication.ts`) that buffers
snapshots and answers "where was everything at server time _t_?". Grenades are
interpolated between the two surrounding snapshots. Players are interpolated
between their _reports_: each `PlayerSnapshot` carries `positionAt`, the server
time the owning client last sent `player:position`, and a snapshot that merely
repeats the previous report adds nothing. Rendering runs ~100 ms behind the
newest snapshot (`interpolationDelayMs`) to hide network jitter. Never
extrapolates.

## Modules

**Contract.** `shared/src/events.ts` + `types.ts` + `contract.ts`.
`ClientToServerEvents` and `ServerToClientEvents` bind every event name to its
payload type; both socket.io ends are generic over them. `GAME_EVENTS` is
derived from the maps so a name lives exactly once. Adding an event means
adding it here and nowhere else.

**Simulation (shared).** `shared/src/sim/`: pure, deterministic TypeScript with
no Three.js and no sockets. `vec3`, `aabb` (box + swept segment), `projectile`,
`grenade`, `weapons` (the stat table), `pickups`, `mapLayout` (the deterministic
map both ends build from a seed), `spawnPoints`, `teams`, `match` (the round
loop), `rng`. The server
runs it for real; the client runs parts of it for cosmetics and for building
the same map.

**GameRoom.** `server/src/room/GameRoom.ts`: the whole game state (players,
teams, projectiles, grenades, crates, pickups, leaderboard, team scores, match
phase) plus `join`, `leave`, `applyIntent`, `tick`. Pure TypeScript; talks
outward only through a `RoomTransport` port. One instance today.

**Transport / adapter.** `RoomTransport` (`server/src/room/transport.ts`) is
GameRoom's outbound port: `send(playerId, …)` and `broadcast(…)`.
`adapters/socketio.ts` is the production adapter; `adapters/memory.ts` is the
test adapter with fake clients that record what they receive. GameRoom tests
run entirely through the memory adapter.

**NetworkClient.** `app/src/net/NetworkClient.ts`: the client's single socket
wrapper. Typed `send`/`on`, `join` with automatic re-join after reconnect,
`getLeaderboard`. Everything on the client that talks to the server goes
through it; nothing imports `socket.io-client` directly.

**Solid geometry.** The static world both ends must agree on for bullets and
grenades: walls, shop, warehouse and tenement shells, cars, street lights, tree trunks, oil barrels and forklifts. Defined once as
`solidColliders(map)` in `shared/src/sim/mapLayout.ts`, with fixed sizes next
to the specs. `GameRoom` sweeps against it; the client's world colliders stop
cosmetic bullets on it. Crates are solid too but live (HP, destruction), so
they are tracked separately on both ends.

**Movement-only obstacle.** Geometry that blocks the Local player's movement
but lets bullets pass: bushes, traffic cones, trash bags. Movement is client-owned, so
only the client consults these; their sizes still live in the shared map so
every client agrees.

**World colliders (client).** `app/src/environment/WorldColliders.ts`: the
client's mirror of the server's collision world, built from the shared
`MapLayout` and never from meshes: solid geometry, live crates, movement-only
obstacles. Answers `blocksMovement` and `stopsBullet`; the debug overlay draws
exactly what it holds. Players are not in it; they come from the Local player
and Replication and are composed in by the bullet-stop check.

**Renderer (client).** A client class whose only job is to mirror server state
in the scene: `RemotePlayerManager`, `GrenadeRenderer`, `CrateSync`,
`PickupManager` (for server-owned pickups), `MatchPhaseUi` (the round clock,
countdown and round-end board). Renderers read from `Replication` or react to
outcome events; they never decide anything.

**Local player.** `PlayerController` + `WeaponSystem`. Owns movement and
sends intents. Ignores its own entry in snapshots (its position is
authoritative locally) but accepts its own HP/status from outcome events and
its team and spawn from `game:state`.

**Nameplate.** The floating name and health bar over a remote player
(`PlayerNameplates`). Coloured by team and tagged for teammates; the character
model is the same on both sides, so the nameplate is how you tell friend from
foe.

## Art assets

**Texture set.** One surface material as files the game and Blender both
read: `app/public/textures/<slug>/<slug>_{basecolor,roughness,ao}.jpg` and
`<slug>_{normal,height}.png`, plus a `<slug>.texture.json` sidecar recording
how it was made. The basecolor is generated (gpt-image-2, via the
`generate-game-textures` skill); the other maps are derived from it, never
generated separately, so they always line up. Tileable by contract. The
basecolor is a lighting-neutral mid-tone albedo (how the material looks in
flat daylight); the noir mood comes from the scene lighting, not from the
texture.

**Decal.** A single transparent PNG sprite in `app/public/decals/<slug>.png`
laid onto a surface: impact marks, stains, posters. Not tileable, no PBR maps.

**Model.** A prop modelled in Blender (`assets/blender/<name>.blend`, including
the combined `noir-assets.blend` workshop, image
paths relative to the repo) and exported as `app/public/models/<name>.glb`
with geometry, UVs and material *slots* but no images. Material slot names
match texture-set slugs (`crate-planks`); the client attaches the texture set
itself, so re-deriving maps never needs a re-export. Modelled at game scale,
1 unit = 1 m. Exported props have their origin at ground level; the character
is centred on its controller hitbox. Workshop placement does not affect exports.

**Yard prop.** A static trash bag, oil barrel or forklift. `shared/src/sim/props.ts`
owns its type and collision dimensions; the level document owns its placement.
These props do not have HP or destruction behavior.

## Arena

The default map is a 5v5 arena, laid out by `generateMap()` in
`shared/src/sim/mapLayout.ts` and serialized to `shared/levels/default.json`.
Both ends load the JSON; `generateMap()` is the source of truth you regenerate
from (`npm run generate:default-level`).

**Mirrored.** Everything is authored once for the south team (negative Z) and
rotated 180° about the centre for the north team (`ArenaBuilder.both`), so both
sides play the same map. Only the shop at the origin is its own twin. Tests
enforce the symmetry and that hand-placed cover does not interpenetrate.

**Spawn street.** Each team's safe strip along its wall (`z < -28` for south):
its five `SPAWN_POINTS` (the team's spawn zone: blue south, red north), lamps
and litter, nothing to hide behind and nothing to fight over.

**Cover line.** The row at `z ≈ -27` that shields the spawn street from mid: a
car parked across the middle exit, crate bunkers and crate walls on the sides,
each with a spawn point tucked behind it. The gaps between them are the exits.

**Yard.** The approach between the cover line and mid (`-27 < z < -12`): a
crate wall, a forklift and barrels to leapfrog between. Chain-link at
`x = ±19` fences it off from the flanks (bullets cross, players do not).

**Mid.** `|z| < 12`. The shop splits it into a west and an east lane, each with
a crate pyramid at one end and low cover at the other; a loading dock hugs the
shop. Forklifts wedged in the fence gaps are the gates to the flanks.

**Flanks.** The outer lanes along the walls (`|x| > 19`), running the full
length of the map: a wreck, a crate tower and trees for cover. The long way
round mid, with long sightlines and sparse cover.

**Bunker / pyramid / crate wall / tower.** Named crate formations from
`ArenaBuilder`: a 2×2 with one on top you cannot see over; seven crates in
three tiers, the tallest cover on the map; a row with a staggered second row;
oversized crates stacked three high, the flank landmark.

**Style anchor.** A small material-only crop of `mockup-001.png` in the
skill's `refs/style/`, attached to every material generation so palette and
grime level stay consistent. It carries look, not subject; if a material starts
growing crates, the anchor is leaking and is dropped for that call.

## Things that are deliberately client-trusted (for now)

Position and rotation, ammo counts and reloads, weapon switching, dropped
weapon pickups. See "Out of scope" in ADR 0001.

**Character presentation.** `CharacterAnimator` plays Blender-authored actions on
an independently cloned skeleton. `CharacterVisual` places the skin under the
existing controller mesh and translates movement into animation state. The
`PlayerPose` carried with position snapshots describes crouch, grounded state
and reload progress for remote presentation only; it does not change damage or
collision authority. Death animates the skin, and respawn resets the mixer and
controller dimensions. Held weapons follow `WeaponSocket`, with an off-hand IK
constraint and an exact `Muzzle` marker for shot origin and flash placement.

### Interactive yard props

Shared `InteractiveWorld` owns the state machine for tire stacks, timber cover,
explosive barrels, smoke generators, alarm zones and lift gates. `GameRoom` accepts
`world:interact` only from a living nearby player during combat, resolves projectile
and grenade damage, and sends state in both full syncs and snapshots. Round resets
restore cover, timers and closed gates. `world:blast` carries the cosmetic explosion;
player damage and kill credit still use the normal combat path.

V opens/closes a nearby gate or releases smoke. Gates lift 3 m in one second and
reopen if someone occupies the passage during closing. Smoke lasts 7 seconds with
a 22-second activation cooldown. Fuel drums have 45 HP and an 80-damage maximum
blast falling off to zero at 4 m; chains detonate each drum once and leave 8 seconds
of smoke. Tire stacks have 120 HP; timber panels have 80 HP. Alarm zones trigger
within 3 m, sound for 4 seconds and can trigger again after 10 seconds. Burning drums
and warning lamps are ambient dressing. Smoke also hides nameplates behind it.

`WorldColliders` mirrors the shared dynamic boxes. Editor spawn validation includes
closed gates and intact cover. The default arena places the new props in mirrored
pairs, and every new prop type is available in the level editor.

### Loot weapons and dedicated ammunition

Players start with the existing pistol/rifle/shotgun. Crates can drop **any**
weapon (the loot rocket launcher, flamethrower, precision rifle and arc gun, or one
of the starting three), each with a loaded magazine and a modest matching ammo
bundle, and **any throwable** (below). `CRATE_DROP_ODDS` (`shared/src/sim/pickups.ts`)
splits a successful crate drop 30% weapon / 20% throwable / 25% health / 25% ammo.
Ammo pickups use weapon-specific quantities: 2 rockets, 40 fuel, 8 .308 rounds or 12
arc cells. Unowned-weapon ammo is banked locally until acquisition, and duplicate
weapon loot becomes matching ammo. Inventory supports seven slots (1–7 or Q/E);
remote players equip by weapon ID so acquisition order does not affect what others
see. Pickup claiming remains server owned; inventory, ammunition and throwable
counts retain the existing client-trusted authority model.

**Throwable pickup.** `PickupSpec { kind: "throwable", grenadeKind, amount }`,
rendered as a pair of that kind's casing on a ring (`ThrowablePickup`). On
`pickup:taken` the claimant adds `amount` to its count for that kind; the server
only removes the pickup and broadcasts, as for ammo.

Rocket impacts/ground hits/range expiry detonate with 120 maximum damage falling to
zero at 5.5 m, including self-damage; solid cover blocks player splash. Flames are
three short-lived projectiles per fuel unit with a seven-metre range. Precision
rifles fire fast 85-damage rounds with a long refire delay. Arc shots deal 32 damage
and can jump to two additional players within four metres for 20/12 damage; solid
cover blocks jumps. Server-selected arc endpoints and blast events drive effects.

### Grenade kinds

**Grenade kind.** `GrenadeKind = "frag" | "smoke" | "flash" | "gas" | "molotov"`
(`shared/src/sim/grenade.ts`). Every kind flies and bounces identically
(`GRENADE`) and shares the one throw cooldown; they differ in what sets them off
(the fuse, or for the molotov the first impact: `shattersOnImpact`) and in what
the detonation does (`GRENADE_EFFECTS`). `grenade:throw` carries the kind, the
server validates it (`isGrenadeKind`) and echoes it on the grenade's snapshots
and on `grenade:exploded`. The client selects the kind with C and throws with F.

**Throwable loadout.** `GRENADE_LOADOUT[kind] = { start, pickup }`: how many of
each kind a player spawns with (2 frag, 1 smoke, 1 flash; gas and molotovs are
loot only) and how many a throwable pickup grants. Counts live on the client
(`PlayerController.throwables`), are client-trusted like ammo, drop by one per
throw, top back up to `start` on respawn (loot already carried is kept), and show
in the HUD's throwable slot. C cycles only through kinds with something left;
throwing the last one moves the selection on.

- **Frag**: the blast (`blastDamage`, 90 falling to zero at 5 m); hits travel
  as `combat:hit` with source `grenade` and damage crates and yard props.
- **Smoke**: leaves a **cloud** (below) of radius 3.5 m for 9 s that hides
  nameplates behind it (`cloudObscures`, joining the yard smoke test). No damage.
- **Flash**: blinds everyone alive within 9 m who has a clear line to it, the
  thrower included, harder up close (`flashIntensity`, linear to zero at the
  radius; solid cover blocks it like rocket splash). `grenade:exploded.flashed`
  lists `{ targetId, intensity }`; a blinded client whites out its own screen
  for up to 3.5 s (`FlashOverlay`). Blindness is presentation only: no HP, no
  server-side state.
- **Gas**: leaves a cloud of radius 3 m for 8 s that poisons anyone whose body
  centre stands inside it (`cloudContains`) at 12 damage per second, applied in
  whole points like car contact, with source `gas` and kill credit to the
  thrower.
- **Molotov**: a bottle that shatters on the first surface it touches (ground,
  wall, crate) instead of waiting for a fuse, and leaves a **fire** cloud of
  radius 2.5 m for 6 s that burns anyone standing in it at 25 damage per
  second, applied like gas, with source `fire` and kill credit to the thrower.
  Fire hides nothing. Standing in overlapping gas and fire takes only the
  harsher rate; hazards do not stack.

**Cloud.** `Cloud { id, kind: CloudKind, ownerId, position, remaining }` with
`CloudKind = "smoke" | "gas" | "fire"`, server-owned, spawned where a smoke, gas
or molotov grenade went off (on the ground) and ticked down each tick; gone at
zero. `cloudKindOf(grenadeKind)` names the cloud a kind leaves (null for frag
and flash); `CLOUD_EFFECTS[cloudKind]` holds its radius, duration and damage per
second (0 for smoke). Snapshots carry `clouds` as `{ id, kind, position,
remaining }`; clouds do not move, so the client draws the newest snapshot's list
without interpolation (`GrenadeClouds`). Round resets clear them. Clouds are not
colliders and are unrelated to the yard's `smoke-zone` prop, which stays an
interactive prop.

### Team silhouettes and district surroundings

Blue uses the Team A reference silhouette (fedora, layered waistcoat, long split
coat); red uses Team B (watch cap, short hooded jacket, vest/pouches, cargo pockets,
kneepads, red scarf/armband). Team model changes are asynchronous and generation
guarded so stale loads cannot replace the latest team. Gameplay hitboxes and all
nine movement clips are preserved; shared geometry/materials and per-player rigs
keep the browser cost bounded.

The 400 m asphalt surface preserves the original texture scale while extending
past the playable yard. Reflections fade at distance and the fog/background share
a blue-grey horizon instead of black. `CityAtmosphere` adds
instanced distant buildings/windows, a bounded 180-streak rain field and 16
drifting paper scraps. Dressing stays outside the collision map, which remains
authoritative.

### Armor and loot visuals

Armor is a server-owned pickup (`kind: armor`), restoring 25 points up to 50.
It absorbs incoming damage one-for-one before HP across the combat resolver,
including area/hazard damage, and resets to zero on respawn/round reset.
Snapshots, hit events and pickup-taken events replicate the remaining value;
the HUD displays it beside health. Random spawns include 15% armor; crate
contents include 10% armor after the existing chance to drop anything.
The loot GLBs live in `app/public/models/noir-ammo-*`, `noir-health-pickup`,
`noir-armor-pickup`, and `noir-projectile-*`; the source is `noir-loot.blend`.
Flame remains a lightweight translucent particle; solid projectiles use cached
GLBs with tracers. Pickup hover animates a child so server spawn height is stable.
