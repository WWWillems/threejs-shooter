# Context: the language of this codebase

Terms that carry a precise meaning here. Use them in code, comments, commits and
conversation; when a term stops fitting, change this file in the same change.

## Authority

**Hybrid authority.** Clients own their own movement; the server owns every
_outcome_. Rationale and rejected alternatives in
[ADR 0001](docs/adr/0001-hybrid-authority.md).

**Intent.** A client-to-server message asking for something that affects other
players or the world: `weapon:shoot`, `grenade:throw`, `pickup:claim`,
`player:respawn`. The server may drop an intent (fire-rate violation, throw
cooldown, out of reach, already dead). Nothing changes in the world until the
server says so.

**Outcome event.** A discrete server-to-client message stating that something
happened: `combat:hit`, `combat:kill`, `player:respawn`, `crate:damaged`,
`crate:destroyed`, `pickup:spawned`, `pickup:taken`, `pickup:expired`,
`grenade:exploded`. Clients apply outcomes without question, including to the
local player (HP, death, respawn position).

**Cosmetic.** Anything a client draws that has no bearing on game state. Client
bullets are cosmetic: they fly, stop at the first thing they touch and leave an
impact mark, but never deal damage. The server's rebroadcast of `weapon:shoot`
is also cosmetic; it exists so other clients can draw the same bullet.

## Time

**Tick.** One step of the server simulation. `TICK_RATE` is 20 Hz
(`shared/src/types.ts`). All server physics (projectiles, grenades, car
contact) advance per tick with a fixed `dt`, independent of wall-clock jitter.

**Snapshot.** `world:snapshot { tick, serverTime, players, grenades }`,
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
map both ends build from a seed), `spawnPoints`, `rng`. The server runs it for
real; the client runs parts of it for cosmetics and for building the same map.

**GameRoom.** `server/src/room/GameRoom.ts`: the whole game state (players,
projectiles, grenades, crates, pickups, leaderboard) plus `join`, `leave`,
`applyIntent`, `tick`. Pure TypeScript; talks outward only through a
`RoomTransport` port. One instance today.

**Transport / adapter.** `RoomTransport` (`server/src/room/transport.ts`) is
GameRoom's outbound port: `emit(to, …)` and `broadcast(…)`.
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
`PickupManager` (for server-owned pickups). Renderers read from `Replication`
or react to outcome events; they never decide anything.

**Local player.** `PlayerController` + `WeaponSystem`. Owns movement and
sends intents. Ignores its own entry in snapshots (its position is
authoritative locally) but accepts its own HP/status from outcome events.

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
its five `SPAWN_POINTS`, lamps and litter, nothing to hide behind and nothing
to fight over.

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
