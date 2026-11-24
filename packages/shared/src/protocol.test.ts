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
import {
  CHAT_MAX_LENGTH,
  PICKER_EMOTES,
  PICKER_PHRASES,
  REACTIONS,
  chatLength,
  isReactionId,
  normalizeChat,
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

describe("quick reactions", () => {
  it("are a fixed list of unique ids, each with something to show and a name to read", () => {
    const ids = REACTIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REACTIONS) {
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("only ever grow: every id ever sent is still one, in the order it was added", () => {
    // An id may be in flight to, or remembered by, a client loaded before a change:
    // the whole list is pinned, so removing, renaming or reordering one fails here.
    expect(REACTIONS.map((r) => r.id)).toEqual([
      "thumbs-up",
      "laugh",
      "wow",
      "angry",
      "party",
      "pray",
      "grimace",
      "cry",
      "facepalm",
      "fingers-crossed",
      "fire",
      "cool",
      "nice",
      "oops",
      "hurry",
      "grabby",
      "well-played",
      "good-luck",
      "oof",
      "ouch",
      "yikes",
      "phew",
      "ha",
      "close-one",
      "gg",
      "i-hate-you",
      // The Clash-style emotes and phrases (2026-11): new phrases only; the emotes
      // reuse the emoji ids they replace.
      "good-game",
      "thanks",
      "hewf",
      "wow-phrase",
      "bruh",
      "marva",
      "you-stink",
      "crud",
    ]);
    // The picker shows a chosen few, so this only bounds how far the wire list
    // grows: a cap that keeps an accidental flood of ids out of review.
    expect(REACTIONS.length).toBeLessThanOrEqual(40);
  });

  it("offer the user's eight emotes and fourteen phrases, in the user's order", () => {
    expect(PICKER_EMOTES).toEqual([
      "laugh",
      "cry",
      "angry",
      "thumbs-up",
      "wow",
      "party",
      "grimace",
      "cool",
    ]);
    const label = (id: string) => REACTIONS.find((r) => r.id === id)?.label;
    expect(PICKER_EMOTES.map(label)).toEqual([
      "Laughing",
      "Crying",
      "Angry",
      "Thumbs up",
      "Wow",
      "Cheering",
      "Oops",
      "Smug",
    ]);
    expect(PICKER_PHRASES.map(label)).toEqual([
      "Good game",
      "Well played",
      "Thanks!",
      "Oops",
      "Nice!",
      "Hurry up!",
      "Grabby!",
      "I hate you!",
      "Hewf!",
      "Wow!",
      "Bruh",
      "Marva!",
      "You stink!",
      "Crud",
    ]);
    // An emote is drawn, so its text (the emoji an older page shows) is not its
    // label; a phrase is its own label. The picker tells them apart by that.
    for (const id of PICKER_EMOTES) {
      const r = REACTIONS.find((x) => x.id === id)!;
      expect(r.text).not.toBe(r.label);
    }
    for (const id of PICKER_PHRASES) {
      const r = REACTIONS.find((x) => x.id === id)!;
      expect(r.text).toBe(r.label);
    }
  });

  it("recognize only their own ids, whatever else arrives", () => {
    for (const r of REACTIONS) expect(isReactionId(r.id)).toBe(true);
    for (const bad of ["", "Nice!", "nice ", 1, null, undefined, {}, ["nice"]]) {
      expect(isReactionId(bad)).toBe(false);
    }
  });
});

describe("a chat message", () => {
  it("is as long as two hundred characters, counting an emoji as one", () => {
    // Pinned as a literal: the client's input stops at it and a person chose it.
    expect(CHAT_MAX_LENGTH).toBe(200);
    expect(chatLength("hello")).toBe(5);
    expect(chatLength("👍🎉")).toBe(2);
  });

  it("is trimmed, with every run of whitespace one space", () => {
    expect(normalizeChat("  nice   one  ")).toBe("nice one");
    expect(normalizeChat("well\n\nplayed\tall")).toBe("well played all");
    expect(normalizeChat("a  b")).toBe("a b");
    expect(normalizeChat("good luck 🍀")).toBe("good luck 🍀");
  });

  it("carries nothing invisible: no control characters, no direction overrides", () => {
    expect(normalizeChat("be\u0000ep \u0007ok")).toBe("beep ok");
    expect(normalizeChat("a \u0000 b")).toBe("a b");
    expect(normalizeChat("‮evil‬ ⁦x⁩")).toBe("evil x");
    // A joined emoji keeps its joiner: only the characters listed are taken out.
    expect(normalizeChat("👨‍👩‍👧")).toBe("👨‍👩‍👧");
  });

  it("is nothing when it is not text or nothing is left of it", () => {
    for (const bad of ["", "   ", "\n\t", "\u0000‮", 5, null, undefined, {}, ["hi"]]) {
      expect(normalizeChat(bad)).toBeNull();
    }
  });
});
