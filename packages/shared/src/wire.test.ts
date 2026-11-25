import { describe, expect, it } from "vitest";
import {
  isAckFrame,
  joinPath,
  NO_ROOM,
  parseRoomPath,
  PING,
  PONG,
  socketPath,
  tablePath,
} from "./wire";

describe("table paths", () => {
  it("round-trips a code through the look, join and socket paths", () => {
    expect(parseRoomPath(tablePath("ABC234"))).toEqual({ roomId: "ABC234", what: "look" });
    expect(parseRoomPath(joinPath("ABC234"))).toEqual({ roomId: "ABC234", what: "join" });
    expect(parseRoomPath(socketPath("ABC234"))).toEqual({ roomId: "ABC234", what: "socket" });
  });

  it("pins the paths the two servers and the client agree on", () => {
    expect(tablePath("ABC234")).toBe("/api/rooms/ABC234");
    expect(joinPath("ABC234")).toBe("/api/rooms/ABC234/join");
    expect(socketPath("ABC234")).toBe("/api/rooms/ABC234/socket");
  });

  it("pins the refusal for a code with no table, which the client recognizes", () => {
    expect(NO_ROOM).toBe("no room with that code");
  });

  it("escapes a code that is not a plain word, and reads it back", () => {
    expect(parseRoomPath(socketPath("A B/C"))).toEqual({ roomId: "A B/C", what: "socket" });
  });

  it("recognises nothing in a path whose code is not a well-formed escape", () => {
    expect(parseRoomPath("/api/rooms/%E0/socket")).toBeNull();
    expect(parseRoomPath("/api/rooms/%zz/join")).toBeNull();
  });

  it("recognises nothing else", () => {
    for (const path of [
      "/api/rooms",
      "/api/rooms/",
      "/api/rooms/ABC234/",
      "/api/rooms/ABC234/leave",
      "/rooms/X/join",
    ]) {
      expect(parseRoomPath(path)).toBeNull();
    }
  });
});

describe("frames", () => {
  it("tells a reply from a push", () => {
    expect(isAckFrame({ ack: 3, result: { ok: true, data: undefined } })).toBe(true);
    expect(isAckFrame({ event: "room", payload: {} })).toBe(false);
  });
});

describe("the keep-alive", () => {
  it("is plain text a runtime can match exactly, and never parses as a frame", () => {
    // Pinned as literals: a Durable Object's auto-response matches these bytes.
    expect([PING, PONG]).toEqual(["ping", "pong"]);
    expect(() => JSON.parse(PING)).toThrow();
  });
});
