# ADR 0002: Two server-assigned teams with friendly fire

- Status: accepted
- Date: 2026-09

## Context

Until now every player was everyone else's opponent: one leaderboard sorted by
score, spawn points shared by all, the client picking its own first spawn. The
arena, however, was already laid out for five against five ([CONTEXT.md,
Arena](../../CONTEXT.md#arena)): two mirrored halves, each with a spawn street
along its wall. We wanted the game to play that way: two sides, a team score,
a leaderboard that reads as blue versus red.

The room is small (ten players), there is no lobby, no matchmaking and no
ranked stakes. People join mid-game and drop out mid-game. Whatever we chose
had to keep the existing intent/outcome shape from [ADR 0001](0001-hybrid-authority.md):
the server owns every outcome, and a team is an outcome.

## Decision

- **Two fixed teams, blue and red, five players each.** `MAX_TEAM_SIZE = 5`,
  `MAX_PLAYERS = 10` in `shared/src/sim/teams.ts`. Blue owns the south spawn
  street, red the north one; every spawn point carries a `team`.
- **The server assigns the team.** On `user:joined` the room puts the player on
  the side with fewer players, blue on a tie (`pickTeam`). There is no team
  choice in the menu and no switching. A player who leaves and re-joins is a
  fresh join: new balanced assignment, kills reset, new spawn.
- **A full room rejects the join.** When both teams are full the server answers
  `user:join-rejected { reason: "room-full" }` and registers nothing. The
  client's menu stays open and shows the reason. No queue, no spectating.
- **The server picks the initial spawn.** `position` is gone from the join
  payload. The joiner learns its team and spawn from its own entry in
  `game:state`, which is now sent *after* registration so that entry exists.
  Respawns already worked this way; they are now filtered to the team's zone.
- **Friendly fire is on, with a penalty.** Bullets and grenades hurt teammates
  exactly like enemies. A team kill costs the killer the kill it would have
  earned: `kills -= 1`, `score -= 100`, team score `-= 1`. The victim's death
  counts as usual. Totals may go negative. `combat:kill` carries a `teamKill`
  flag so the HUD can name it.
- **The team score is its own counter.** `GameRoom.teamScores` counts kills per
  team since the room started and is not derived from the leaderboard rows, so
  a leaver's kills stay on the board. It travels on every `combat:kill` (for
  an instant HUD update) and in `GET /leaderboard` as `teams` next to the
  per-player `players`.
- **In the world, only the nameplate shows the team.** Name and health bar are
  coloured blue or red and teammates get a marker. The character model is
  untouched.

## Alternatives considered

### Player-chosen teams

A blue/red picker in the menu, possibly with a switch-team key in game.

Rejected: with ten slots and mid-game joins, choice produces 5 v 1 rooms and
switch-to-the-winning-side. Balance is a server concern, like every other
outcome. A "prefer this team" hint could be added later without changing the
event shape: the server would still decide.

### Forced rebalancing

Move a player from the larger team when the counts drift apart after leavers.

Rejected: being teleported to the other side mid-fight, with your kills
suddenly counting for the enemy, is worse than a temporary 3 v 2. Joiners
always fill the smaller team, so the imbalance self-corrects.

### Friendly fire off

Damage from a teammate is ignored on the server.

Rejected: it removes a whole class of positioning decisions (grenades near
teammates, shooting through a friend) and it makes the mirrored arena, where
both teams pour through the same exits, too forgiving. It also needs a special
case in every damage path; the penalty needs one line in the kill branch.

### Friendly fire on, no credit

A team kill counts nothing for the killer: no kill, no penalty.

Rejected: with no cost, spraying into a crowd is free. Mirroring the reward as
a penalty keeps the arithmetic obvious (a team kill undoes an enemy kill) and
makes the team score honest.

### Team score as a sum of leaderboard rows

Compute `teams` from `leaderBoard` on demand.

Rejected: rows disappear when players leave, so the score would drop the
moment a top player disconnected. An independent counter also makes rounds
and resets trivial later.

### Client-chosen initial spawn kept

Keep `position` in the join payload and only filter respawns by team.

Rejected: a client could spawn on the enemy street, and the server would have
to trust a position for a player it had just placed on a team. Owning both the
first spawn and respawns is one code path (`pickSpawnFor`) and one contract.

## Consequences

- `PlayerSnapshot`, `LeaderboardEntry` and the `user:joined` broadcast carry
  `team`; `combat:kill` carries `teamKill` and `teamScores`; `/leaderboard`
  returns `{ players, teams }`. The level schema is at version 2 (spawn points
  have a `team`).
- The local player is not in the world until `game:state` arrives. Before
  that the client sends no position reports and the menu can still show a
  rejection.
- `pickSpawnPoint` is only ever called with one team's points, so a level with
  a team that has no spawn point is unloadable (validator error).
- Team kills can push a player's kills and score below zero; the HUD shows the
  negative rather than clamping it.
- No rounds, no win condition, no reset: the team score runs until the server
  restarts. Rounds are the natural next step and only touch `GameRoom` and one
  outcome event.

## Out of scope at the time of this decision

Team choice or preference, mid-game rebalancing, rounds and match end, team
chat, team-coloured character models, spectating a full room.
