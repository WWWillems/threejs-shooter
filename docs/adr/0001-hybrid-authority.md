# ADR 0001: Hybrid authority — clients own movement, server owns outcomes

- Status: accepted
- Date: 2026-09

## Context

The first version of the game was a relay: the server forwarded every client
message to every other client and each client decided for itself whether its
bullets hit, how much HP it had, and when it died. The leaderboard could not be
correct (kills were counted by whoever happened to notice) and two clients
routinely disagreed about who was alive. We wanted to add grenades and
destructible crates, both of which need a single answer to "what happened".

The game is an isometric shooter with a handful of players per room, no
matchmaking, and no ranked or competitive stakes. Latency tolerance is
moderate: hitscan-feeling weapons matter more than pixel-perfect movement.

## Decision

Split authority by what a message affects:

- **Clients own their own movement.** Each client reports its position and
  rotation (`player:position`, 10 Hz) and the server takes it at face value as
  that player's last-known state. No server-side movement simulation, no
  prediction, no reconciliation.
- **The server owns every outcome.** Anything that affects another player or
  the world is sent as an _intent_ (`weapon:shoot`, `grenade:throw`,
  `pickup:claim`, `player:respawn`) and resolved on the server in a fixed
  20 Hz tick: projectile sweep against world AABBs and last-known player
  boxes, grenade physics and blast, crate HP, pickup spawning and claiming, car
  contact damage, HP, death, respawn, kills/deaths/score.
- **Replication is a snapshot stream plus events.** Continuous state (players,
  grenades) goes in one `world:snapshot` per tick; discrete outcomes go as
  events (`combat:hit`, `combat:kill`, `crate:destroyed`, `grenade:exploded`,
  …). Clients interpolate between snapshots ~100 ms behind server time.
- **Client bullets are cosmetic.** They render immediately for feel, stop at
  the first thing they touch, and never deal damage. The server's bullet is
  the only one that counts and is never replicated.
- **The simulation lives in `shared/src/sim`** as pure TypeScript so the
  server runs it authoritatively and the client can run pieces of it (map
  generation, cosmetic bullet flight, shotgun spread) with identical results.
- **The server is a `GameRoom` module** behind a transport port, with socket.io
  as one adapter and an in-memory adapter for tests.

## Alternatives considered

### Full server authority with client-side prediction

Server simulates movement too; clients predict locally and reconcile against
server corrections. This is the "correct" answer for competitive shooters and
removes movement cheating.

Rejected for now: the reconciliation machinery (input buffering, replay,
smoothing corrections) is the largest single piece of a netcode stack and
none of our current problems are movement problems. Movement stays
client-trusted and can be moved server-side later without changing the
intent/outcome shape; only `player:position` would become an input stream.

### Owner authority (the shooter decides hits)

The client that fired reports hits; the server relays them. Cheapest to
build and what we had implicitly.

Rejected: it is exactly the model that produced the inconsistent leaderboard.
Two clients can each believe they killed the other. Grenades and crates make
this worse because several shooters can affect one object in the same frame.

### Peer-to-peer (WebRTC) with a designated host

Early code had WebRTC signalling handlers. Rejected: host migration, NAT
traversal and a host with a latency advantage are all costs we do not need
when we already run a server.

## Consequences

- The leaderboard, HP and world state are consistent across clients by
  construction; there is a single writer.
- Shooting feels immediate (cosmetic bullet) but the hit marker and damage
  arrive one round-trip later. Acceptable at LAN/regional latencies.
- Movement is still client-trusted, so speed hacks are possible. Out of scope.
- Ammo, reloads and weapon switching are client-trusted; the server only
  validates fire rate. Server-owned inventory is a natural next step and would
  turn `weapon:switch`/reload into intents.
- Remote players are rendered ~100 ms in the past. Shots are resolved against
  the server's last-known positions, so a shot that looks like a hit on the
  shooter's screen can miss on the server when the target is moving fast. Lag
  compensation (rewinding targets to the shooter's view time) is a possible
  later refinement.
- Every new game mechanic needs three things: an intent or outcome in the
  contract, handling in `GameRoom`, and a renderer on the client. Tests for
  the mechanic run through the memory adapter with no sockets.

## Out of scope at the time of this decision

Client-side movement prediction/reconciliation, server-owned ammo/inventory,
lag compensation, delta-compressed snapshots, multiple rooms/lobby UI,
anti-cheat on movement.
