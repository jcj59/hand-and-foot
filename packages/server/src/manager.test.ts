import { describe, it, expect } from "vitest";
import { EAST_COAST } from "@hf/shared";
import { FakeClock } from "./clock";
import { DEFAULT_ABANDONED_ROOM_MS, RoomManager } from "./manager";
import { InMemoryRoomStore } from "./store";

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

  it("reaps a room once everyone has been gone long enough", () => {
    // Not tidiness: an all-default table never ends its round, because the
    // policy never melds, so an abandoned room would play forever.
    const clock = new FakeClock(1_000);
    const manager = new RoomManager({ clock, abandonedRoomMs: 5_000 });
    const room = manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);

    room.setConnected(0, false);
    room.setConnected(1, false);
    clock.advance(4_999);
    expect(manager.sweep()).toEqual([]);
    expect(manager.size).toBe(1);

    clock.advance(2);
    expect(manager.sweep()).toEqual([room.id]);
    expect(manager.size).toBe(0);
    // And its turn clock went with it.
    expect(clock.pendingCount()).toBe(0);
  });

  it("keeps a room where anyone is still connected", () => {
    const clock = new FakeClock(1_000);
    const manager = new RoomManager({ clock, abandonedRoomMs: 5_000 });
    const room = manager.create();
    room.join("ana");
    room.join("ben");
    room.setConnected(0, false);
    clock.advance(100_000);
    expect(manager.sweep()).toEqual([]);
    expect(manager.size).toBe(1);
  });

  it("reaps a code that was generated and never used", () => {
    const clock = new FakeClock(1_000);
    const manager = new RoomManager({ clock, abandonedRoomMs: 5_000 });
    manager.create();
    clock.advance(5_001);
    expect(manager.sweep()).toHaveLength(1);
  });

  it("sweeps on its own schedule once started, and stops when told", () => {
    const clock = new FakeClock(1_000);
    const manager = new RoomManager({ clock, abandonedRoomMs: 1_000, sweepIntervalMs: 500 });
    manager.create();
    manager.startSweeping();
    // Starting twice must not stack two sweep loops.
    manager.startSweeping();

    clock.advance(2_000);
    expect(manager.size).toBe(0);

    manager.create();
    manager.stopSweeping();
    clock.advance(10_000);
    expect(manager.size).toBe(1);
    manager.disposeAll();
    expect(clock.pendingCount()).toBe(0);
  });

  it("releases a removed room's timer", () => {
    const clock = new FakeClock(1_000);
    const manager = new RoomManager({ clock });
    const room = manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);
    expect(clock.pendingCount()).toBe(1);
    expect(manager.remove(room.id)).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });

  it("defaults a room to the engine's default rules", () => {
    expect(newManager().create().config).toEqual(EAST_COAST);
  });

  it("takes a config override when one is given", () => {
    const competitive = { ...EAST_COAST, mode: "competitive" as const, pauseEnabled: false };
    expect(newManager().create(competitive).config.pauseEnabled).toBe(false);
  });
});

describe("keeping rooms in a store", () => {
  function withStore(): { manager: RoomManager; store: InMemoryRoomStore; clock: FakeClock } {
    const store = new InMemoryRoomStore();
    const clock = new FakeClock();
    let uid = 0;
    const manager = new RoomManager({ clock, store, newUid: () => `uid-${uid++}` });
    return { manager, store, clock };
  }

  it("records a room the moment it is opened, before anyone sits down", async () => {
    // A table dealt before anyone else joins still writes its log against a room
    // that exists.
    const { manager, store } = withStore();
    const room = manager.create();
    const [stored] = await store.loadOpen();
    expect(stored?.room).toEqual(room.record());
    expect(stored?.room.uid).toBe("uid-0");
    expect(stored?.room.players).toEqual([]);
  });

  it("gives every room its own storage identity, whatever its code", () => {
    const { manager } = withStore();
    expect(manager.create().uid).toBe("uid-0");
    expect(manager.create().uid).toBe("uid-1");
  });

  it("falls back to a random uuid when none is injected", () => {
    const room = new RoomManager({ clock: new FakeClock() }).create();
    expect(room.uid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("closes a room in the store when it is removed or reaped", () => {
    const { manager, store, clock } = withStore();
    const removed = manager.create();
    const reaped = manager.create();
    manager.remove(removed.id);
    expect(store.closedAt("uid-0")).toBe(clock.now());

    clock.advance(DEFAULT_ABANDONED_ROOM_MS);
    manager.sweep();
    expect(store.closedAt(reaped.uid)).toBe(clock.now());
  });

  it("leaves rooms open in the store when the process shuts down", () => {
    // A shutdown is the restart persistence exists to survive, not the end of
    // the games.
    const { manager, store } = withStore();
    const room = manager.create();
    manager.disposeAll();
    expect(store.closedAt(room.uid)).toBeNull();
  });

  it("brings stored rooms back under their own codes", async () => {
    const before = withStore();
    const room = before.manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);

    const after = new RoomManager({ clock: new FakeClock(), store: before.store });
    expect(after.restore(await before.store.loadOpen())).toEqual([]);
    expect(after.size).toBe(1);
    const restored = after.get(room.id.toLowerCase());
    expect(restored?.gameState).toEqual(room.gameState);
    expect(restored?.uid).toBe(room.uid);
  });

  it("reports a room that will not replay, and closes it so the next boot does not retry it", async () => {
    const { manager, store } = withStore();
    const room = manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);
    const [stored] = await store.loadOpen();
    const broken = {
      ...stored!,
      actions: [
        {
          seq: 0,
          seat: 0,
          action: { type: "discard" as const, cardId: "nope" },
          source: "player" as const,
          at: 0,
        },
      ],
    };

    const after = new RoomManager({ clock: new FakeClock(), store });
    const failures = after.restore([broken]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ uid: room.uid, id: room.id });
    expect(failures[0]?.error).toMatch(/action 0/);
    expect(after.size).toBe(0);
    expect(store.closedAt(room.uid)).not.toBeNull();
  });

  it("refuses to restore two rooms under one code", async () => {
    const { manager, store } = withStore();
    const room = manager.create();
    const [stored] = await store.loadOpen();
    const twin = { ...stored!, room: { ...stored!.room, uid: "uid-twin" } };
    const failures = manager.restore([twin]);
    expect(failures).toEqual([
      { uid: "uid-twin", id: room.id, error: `room ${room.id}: that code is already in use` },
    ]);
    expect(manager.get(room.id)).toBe(room);
  });

  it("never issues a new room the code of a restored one", async () => {
    // Both managers draw all-zero first, so the new one's first code is exactly
    // the restored room's; it must draw again rather than hand out a live table.
    const store = new InMemoryRoomStore();
    const before = new RoomManager({ clock: new FakeClock(), random: () => 0, store });
    const room = before.create();
    let calls = 0;
    const random = (): number => (++calls <= 6 ? 0 : 0.5);
    const after = new RoomManager({ clock: new FakeClock(), random, store });
    after.restore(await store.loadOpen());
    expect(after.get(room.id)).toBeDefined();
    const fresh = after.create();
    expect(calls).toBeGreaterThan(6);
    expect(fresh.id).not.toBe(room.id);
  });
});
