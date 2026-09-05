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
    /** Client -> server: I died / respawned. Server -> others: same. */
    STATUS: "player:status",
  },
  WEAPON: {
    /** Client -> server: I fired. Server -> others: someone fired (cosmetic bullet). */
    SHOOT: "weapon:shoot",
    /** Client -> server: I switched weapon. Server -> others: same. */
    SWITCH: "weapon:switch",
  },
} as const;
