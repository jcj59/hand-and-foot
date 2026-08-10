import { describe, it, expect } from "vitest";
import { EAST_COAST, WEST_COAST } from "@hf/shared";
import { FakeClock } from "./clock";
import { configFor, RoomManager } from "./manager";

/** A deterministic stand-in for Math.random, cycling a fixed sequence. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function newManager(random = Math.random): RoomManager {
  return new RoomManager({ clock: new FakeClock(), random });
}

describe("room codes", () => {
  it("issues codes from an alphabet with no look-alike characters", () => {
    // These get read aloud across a table and typed off a link, so O/0 and I/1/L
    // are left out on purpose.
    const manager = newManager();
    for (let i = 0; i < 50; i++) {
      const code = manager.create().id;
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
      expect(code).not.toMatch(/[O0I1L]/);
    }
  });

  it("never hands out a code that is already live", () => {
    // A rigged random returns the same value forever, so the first code would
    // repeat; the manager must keep drawing rather than drop a stranger into
    // someone else's game.
    let calls = 0;
    const random = (): number => {
      calls++;
      // Same code for the first two rooms' worth of draws, then a different one.
      return calls <= 30 ? 0 : 0.5;
    };
    const manager = newManager(random);
    const first = manager.create();
    const second = manager.create();
    expect(second.id).not.toBe(first.id);
    expect(manager.size).toBe(2);
  });

  it("looks a room up case-insensitively", () => {
    const manager = newManager();
    const room = manager.create();
    expect(manager.get(room.id.toLowerCase())?.id).toBe(room.id);
    expect(manager.get(room.id)?.id).toBe(room.id);
  });

  it("returns nothing for a code that was never issued", () => {
    expect(newManager().get("ZZZZZZ")).toBeUndefined();
  });
});

describe("joining through the manager", () => {
  it("seats a player and hands back their credentials", () => {
    const manager = newManager();
    const room = manager.create();
    const joined = manager.join(room.id.toLowerCase(), "ana");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.seat).toBe(0);
    expect(joined.value.token).toHaveLength(24);
    expect(joined.value.room.id).toBe(room.id);
  });

  it("rejects a join for a room that does not exist", () => {
    const joined = newManager().join("NOPE99", "ana");
    expect(joined.ok).toBe(false);
  });

  it("passes a room-level refusal straight through", () => {
    const manager = newManager();
    const room = manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);
    expect(manager.join(room.id, "late").ok).toBe(false);
  });
});

describe("configFor", () => {
  it("defaults to the East Coast family game", () => {
    // The rules this was built for, so opening a room with no choices at all
    // gives the game the family actually plays.
    expect(configFor()).toEqual(EAST_COAST);
    expect(configFor({})).toEqual(EAST_COAST);
  });

  it("selects the West Coast preset", () => {
    expect(configFor({ preset: "west-coast" })).toEqual(WEST_COAST);
    expect(configFor({ preset: "west-coast" }).wildRatio).toBe("naturals-equal-wilds");
  });

  it("ties pausing to the mode rather than leaving it a second switch", () => {
    // A competitive table is precisely one where the clock cannot be stopped;
    // letting the two be set apart would only create states nobody wants.
    const competitive = configFor({ mode: "competitive" });
    expect(competitive.mode).toBe("competitive");
    expect(competitive.pauseEnabled).toBe(false);

    const family = configFor({ mode: "family" });
    expect(family.mode).toBe("family");
    expect(family.pauseEnabled).toBe(true);
  });

  it("combines a preset with a mode", () => {
    const c = configFor({ preset: "west-coast", mode: "competitive" });
    expect(c.wildRatio).toBe("naturals-equal-wilds");
    expect(c.pauseEnabled).toBe(false);
  });

  it("leaves the preset's own mode alone when none is chosen", () => {
    expect(configFor({ preset: "west-coast" }).pauseEnabled).toBe(WEST_COAST.pauseEnabled);
  });

  it("normalizes a bogus mode arriving over the wire to the family default", () => {
    // Types are erased at runtime, so a socket payload can carry a string
    // outside the GameMode union; simulate that with a cast a real client
    // couldn't produce through the typed API.
    const bogus = configFor({ mode: "whatever" as unknown as "family" });
    expect(bogus.mode).toBe("family");
    expect(bogus.pauseEnabled).toBe(true);
  });
});

describe("seeds and isolation", () => {
  it("gives each room its own seed, so two tables are not the same game", () => {
    const manager = newManager(sequence([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]));
    const a = manager.create();
    const b = manager.create();
    a.join("ana");
    a.join("ben");
    b.join("cy");
    b.join("di");
    a.start(0);
    b.start(0);
    expect(a.gameState!.seed).not.toBe(b.gameState!.seed);
    expect(a.gameState!.players[0].hand.map((c) => c.id)).not.toEqual(
      b.gameState!.players[0].hand.map((c) => c.id),
    );
  });

  it("keeps the seed on the server, out of every projected view", () => {
    // The seed determines the whole deck order. It leaving the process would
    // make every hidden card knowable.
    const manager = newManager();
    const room = manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);
    const seed = String(room.gameState!.seed);
    expect(JSON.stringify(room.viewFor(0))).not.toContain(`"seed"`);
    expect(JSON.stringify(room.viewFor(0)?.view)).not.toContain(seed);
  });

  it("removes a room, and reports whether there was one to remove", () => {
    const manager = newManager();
    const room = manager.create();
    expect(manager.remove(room.id.toLowerCase())).toBe(true);
    expect(manager.size).toBe(0);
    expect(manager.remove(room.id)).toBe(false);
  });

  it("falls back to real randomness when none is injected", () => {
    // The production path: no injected random, so seeds and codes come from
    // Math.random. Two rooms must still differ.
    const manager = new RoomManager();
    const a = manager.create();
    const b = manager.create();
    expect(a.id).not.toBe(b.id);
    expect(manager.size).toBe(2);
  });

  it("defaults a room to the engine's default rules", () => {
    expect(newManager().create().config).toEqual(EAST_COAST);
  });

  it("takes a config override when one is given", () => {
    const competitive = { ...EAST_COAST, mode: "competitive" as const, pauseEnabled: false };
    expect(newManager().create(competitive).config.pauseEnabled).toBe(false);
  });
});
