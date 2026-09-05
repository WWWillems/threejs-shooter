/**
 * Socket event names. This is the only place a wire event name is spelled out;
 * the payload maps in ./contract.ts bind each name to its payload type.
 */
export const GAME_EVENTS = {
  GAME: {
    /** Server -> joining client: snapshot of all players currently in the game. */
    STATE: "game:state",
  },
  WORLD: {
    /** Server -> all, every tick: continuous state of everything that moves. */
    SNAPSHOT: "world:snapshot",
  },
  USER: {
    /** Server -> others: a socket connected (before it joined the game). */
    CONNECTED: "user:connected",
    /** Client -> server: join the game. Server -> others: someone joined. */
    JOINED: "user:joined",
    /** Server -> others: a player left. */
    DISCONNECTED: "user:disconnected",
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
    /** Client -> server: throw intent. Server -> others: someone threw (cosmetic). */
    THROW: "grenade:throw",
    /** Server -> all: a grenade detonated; damage travels as COMBAT.HIT. */
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
