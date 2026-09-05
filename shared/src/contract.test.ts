import { describe, expect, expectTypeOf, it } from "vitest";
import { GAME_EVENTS } from "./events";
import type {
  ClientEventName,
  ClientPayload,
  ClientToServerEvents,
  OutgoingPayload,
  ServerEventName,
  ServerPayload,
  ServerToClientEvents,
} from "./contract";
import type {
  PlayerPositionEvent,
  Stamped,
  UserJoinedEvent,
  WeaponEvent,
} from "./types";

const allEventNames = Object.values(GAME_EVENTS).flatMap((group) =>
  Object.values(group)
);

describe("event contract", () => {
  it("every event name is unique", () => {
    expect(new Set(allEventNames).size).toBe(allEventNames.length);
  });

  it("client -> server events bind to their payloads", () => {
    expectTypeOf<ClientPayload<"user:joined">>().toEqualTypeOf<UserJoinedEvent>();
    expectTypeOf<
      ClientPayload<"player:position">
    >().toEqualTypeOf<PlayerPositionEvent>();
    expectTypeOf<ClientPayload<"weapon:shoot">>().toEqualTypeOf<WeaponEvent>();
  });

  it("server -> client relays are stamped with the sender", () => {
    expectTypeOf<ServerPayload<"user:joined">>().toEqualTypeOf<
      Stamped<UserJoinedEvent>
    >();
    expectTypeOf<ServerPayload<"player:position">>().toHaveProperty("userId");
  });

  it("outgoing payloads omit the transport-added timestamp", () => {
    expectTypeOf<OutgoingPayload<"player:status">>().not.toHaveProperty(
      "timestamp"
    );
  });

  it("every client event the server accepts is a known constant", () => {
    type Client = keyof ClientToServerEvents;
    type Server = keyof ServerToClientEvents;
    expectTypeOf<Client>().toEqualTypeOf<ClientEventName>();
    expectTypeOf<Server>().toEqualTypeOf<ServerEventName>();

    const client: ClientEventName[] = [
      GAME_EVENTS.USER.JOINED,
      GAME_EVENTS.PLAYER.POSITION,
      GAME_EVENTS.PLAYER.STATUS,
      GAME_EVENTS.WEAPON.SHOOT,
      GAME_EVENTS.WEAPON.SWITCH,
    ];
    for (const name of client) {
      expect(allEventNames).toContain(name);
    }
  });
});
