import { describe, it, expect } from "vitest";
import { EAST_COAST, REACTIONS } from "@hf/shared";
import { FakeClock } from "./clock";
import { REACTION_BURST, REACTION_REFILL_MS, ReactionLimiter } from "./reactions";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";

function room(clock = new FakeClock(0), store?: InMemoryRoomStore): Room {
  let n = 0;
  const r = new Room("REACT2", EAST_COAST, {
    clock,
    seed: 3,
    newToken: () => `t${n++}`,
    ...(store ? { store, uid: "u1" } : {}),
  });
  r.join("ana");
  r.join("ben");
  return r;
}

describe("a quick reaction", () => {
  it("is one of the fixed set, from a seat at the table, numbered as it comes", () => {
    const r = room();
    expect(r.react(1, "nice")).toEqual({ ok: true, value: { seq: 1, seat: 1, id: "nice" } });
    expect(r.react(0, "laugh")).toEqual({ ok: true, value: { seq: 2, seat: 0, id: "laugh" } });
    expect(r.react(5, "nice")).toEqual({ ok: false, error: "no such seat" });
    // Free text, or anything else, never crosses: only ids from the list.
    for (const bad of ["you stink", "", 3, null, undefined, { id: "nice" }]) {
      expect(r.react(0, bad)).toEqual({ ok: false, error: "that is not a reaction" });
    }
    expect(REACTIONS.length).toBeGreaterThan(8);
  });

  it("touches nothing in the game, the log, or the stored record", () => {
    const store = new InMemoryRoomStore();
    const r = room(new FakeClock(0), store);
    store.saveRoom(r.record());
    r.start(0);
    const before = { state: r.gameState, log: r.log.length, record: JSON.stringify(r.record()) };
    expect(r.react(0, "party").ok).toBe(true);
    expect(r.gameState).toBe(before.state);
    expect(r.log.length).toBe(before.log);
    expect(JSON.stringify(r.record())).toBe(before.record);
  });
});

describe("how often a seat may react", () => {
  it("allows a burst, then one more every couple of seconds, per seat", () => {
    // Pinned as literals: how chatty the table may get is a decision.
    expect(REACTION_BURST).toBe(3);
    expect(REACTION_REFILL_MS).toBe(2000);
    const clock = new FakeClock(0);
    const limit = new ReactionLimiter(clock);
    expect([limit.take(0), limit.take(0), limit.take(0), limit.take(0)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // Another seat has its own budget.
    expect(limit.take(1)).toBe(true);
    clock.advance(1_999);
    expect(limit.take(0)).toBe(false);
    clock.advance(1);
    // Refused attempts cost nothing: the token earned in the meantime is still there.
    expect(limit.take(0)).toBe(true);
    expect(limit.take(0)).toBe(false);
    // A long quiet fills the bucket, but never past the burst.
    clock.advance(60_000);
    expect([limit.take(0), limit.take(0), limit.take(0), limit.take(0)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("refuses the room's reactions past the budget, saying why", () => {
    const r = room();
    for (let i = 0; i < REACTION_BURST; i++) expect(r.react(0, "nice").ok).toBe(true);
    expect(r.react(0, "nice")).toEqual({ ok: false, error: "too many reactions; wait a moment" });
    expect(r.react(1, "nice").ok).toBe(true);
  });
});
