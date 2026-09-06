/**
 * Socket event names. This is the only place a wire event name is spelled out;
 * the payload maps in ./contract.ts bind each name to its payload type.
 */
export const GAME_EVENTS = {
  GAME: {
    /** Server -> client: authoritative full sync of the world (on join and on every round reset). */
    STATE: "game:state",
  },
  MATCH: {
    /** Server -> all: the match entered a new phase (warmup, countdown, active, round-end). */
    PHASE: "match:phase",
  },
  WORLD: {
    /** Server -> all, every tick: continuous state of everything that moves. */
    SNAPSHOT: "world:snapshot",
    INTERACT: "world:interact",
    BLAST: "world:blast",
    ARC: "world:arc",
  },
  USER: {
    /** Server -> others: a socket connected (before it joined the game). */
    CONNECTED: "user:connected",
    /** Client -> server: join the game. Server -> others: someone joined. */
    JOINED: "user:joined",
    /** Server -> joining client: the join was refused (room full). */
    JOIN_REJECTED: "user:join-rejected",
    /** Server -> others: a player left. */
    DISCONNECTED: "user:disconnected",
  },
  CHAT: {
    /** Client -> server: send a chat message. Server -> all: accepted message. */
    MESSAGE: "chat:message",
  },
  PLAYER: {
    /** Client -> server: my position. Replicated to others via WORLD.SNAPSHOT. */
    POSITION: "player:position",
    /** Client -> server: I want to respawn. Server -> all: a player respawned here. */
    RESPAWN: "player:respawn",
  },
  WEAPON: {
    /** Client -> server: fire intent. Server -> others: someone fired (cosmetic bullet). */
    SHOOT: "weapon:shoot",
    /** Client -> server: I switched weapon. Server -> others: same. */
    SWITCH: "weapon:switch",
  },
  COMBAT: {
    /** Server -> all: a server bullet hit a player. */
    HIT: "combat:hit",
    /** Server -> all: a player's HP reached zero. */
    KILL: "combat:kill",
  },
  CRATE: {
    /** Server -> all: a crate took damage. */
    DAMAGED: "crate:damaged",
    /** Server -> all: a crate's HP reached zero; remove it. */
    DESTROYED: "crate:destroyed",
  },
  GRENADE: {
    /** Client -> server: throw intent (with the grenade kind). Server -> others: someone threw (cosmetic). */
    THROW: "grenade:throw",
    /** Server -> all: a grenade detonated; frag damage travels as COMBAT.HIT, clouds via WORLD.SNAPSHOT. */
    EXPLODED: "grenade:exploded",
  },
  PICKUP: {
    /** Server -> all: a pickup appeared in the world. */
    SPAWNED: "pickup:spawned",
    /** Client -> server: I'm standing on this pickup and want it. */
    CLAIM: "pickup:claim",
    /** Server -> all: a player took a pickup. */
    TAKEN: "pickup:taken",
    /** Server -> all: a pickup timed out. */
    EXPIRED: "pickup:expired",
  },
} as const;
