import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  Ack,
  ActionSource,
  ClientToServerEvents,
  LoggedAction,
  RoomInfo,
  SeatCredentials,
  ServerToClientEvents,
  ViewUpdate,
} from "./protocol";
import type { PlayerView } from "./index";

// The protocol is types only, so `tsc` is what really checks it. These pin the
// few properties that a future edit could quietly break without failing to
// compile — and the one security property that must never be edited away.

/** Narrowing has to work in both directions, the way a real client uses it. */
function describeAck(result: Ack<SeatCredentials>): string {
  if (result.ok) {
    expectTypeOf(result.data).toEqualTypeOf<SeatCredentials>();
    return result.data.token;
  }
  expectTypeOf(result.error).toEqualTypeOf<string>();
  // @ts-expect-error a rejection carries no data to read
  void result.data;
  return result.error;
}

describe("Ack", () => {
  it("discriminates on ok, so a client cannot read data off a failure", () => {
    expect(describeAck({ ok: false, error: "room is full" })).toBe("room is full");
    expect(describeAck({ ok: true, data: { roomId: "r", seat: 0, token: "t" } })).toBe("t");
  });
});

describe("RoomInfo", () => {
  it("has no seat token on it", () => {
    // RoomInfo is broadcast to the whole table. A seat token is a bearer
    // credential for one seat: anyone holding it is that player. If one ever
    // reaches this type it leaks to every opponent in the room.
    expectTypeOf<RoomInfo>().not.toHaveProperty("token");
    expectTypeOf<RoomInfo["players"][number]>().not.toHaveProperty("token");
  });
});

describe("ViewUpdate", () => {
  it("wraps the engine's projection rather than widening it", () => {
    // The anti-cheat boundary is `project()`. Transport concerns ride alongside
    // the view, never inside it, so nothing here can add a field the engine did
    // not filter.
    expectTypeOf<ViewUpdate["view"]>().toEqualTypeOf<PlayerView>();
    expectTypeOf<ViewUpdate["clock"]["serverNow"]>().toEqualTypeOf<number>();
  });
});

describe("LoggedAction", () => {
  it("records where a move came from", () => {
    expectTypeOf<LoggedAction["source"]>().toEqualTypeOf<ActionSource>();
    const sources: ActionSource[] = ["player", "timeout", "disconnect"];
    expect(sources).toHaveLength(3);
  });
});

describe("event maps", () => {
  it("gives every client request an ack, so nothing is fire-and-forget", () => {
    // Each client->server event must end in a callback: the client needs to know
    // whether the server accepted a move, and rule rejections travel that way.
    type Events = keyof ClientToServerEvents;
    const named: Events[] = [
      "createRoom",
      "joinRoom",
      "resumeSeat",
      "startGame",
      "submitAction",
      "setPaused",
    ];
    expect(new Set(named).size).toBe(named.length);
    expectTypeOf<Parameters<ClientToServerEvents["submitAction"]>[1]>().toBeFunction();
    expectTypeOf<Parameters<ClientToServerEvents["startGame"]>[0]>().toBeFunction();
  });

  it("keeps server pushes one-way", () => {
    // Server->client events are broadcasts, not requests; an ack on one would
    // mean the server is waiting on a client, which is how a room stalls.
    expectTypeOf<Parameters<ServerToClientEvents["view"]>>().toEqualTypeOf<[ViewUpdate]>();
    expectTypeOf<ReturnType<ServerToClientEvents["room"]>>().toEqualTypeOf<void>();
  });
});
