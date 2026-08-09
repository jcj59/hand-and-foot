import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { FakeClock } from "./clock";
import { InMemoryActionLog } from "./log";
import { MAX_PLAYERS, Room } from "./room";

let tokenCounter = 0;
function newRoom(config: RulesConfig = EAST_COAST, clock = new FakeClock()): Room {
  tokenCounter = 0;
  return new Room("ABC123", config, {
    clock,
    seed: 42,
    newToken: () => `token-${tokenCounter++}`,
  });
}

function seated(room: Room, names: string[]): void {
  for (const name of names) {
    const joined = room.join(name);
    expect(joined.ok).toBe(true);
  }
}

describe("seating", () => {
  it("assigns seats in join order and makes the first joiner the host", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    expect(room.seats().map((p) => [p.seat, p.name])).toEqual([
      [0, "ana"],
      [1, "ben"],
      [2, "cy"],
    ]);
    expect(room.hostSeat).toBe(0);
  });

  it("refuses a join once the table is full", () => {
    const room = newRoom();
    seated(
      room,
      Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i}`),
    );
    const overflow = room.join("one-too-many");
    expect(overflow.ok).toBe(false);
    expect(room.seatCount).toBe(MAX_PLAYERS);
  });

  it("refuses a join once the game has started", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.start(0).ok).toBe(true);
    expect(room.join("late").ok).toBe(false);
  });

  it("will not start below two players", () => {
    const room = newRoom();
    seated(room, ["ana"]);
    const started = room.start(0);
    expect(started.ok).toBe(false);
    expect(room.started).toBe(false);
  });

  it("will not start twice, or on a non-host's say-so", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.start(1).ok).toBe(false);
    expect(room.start(0).ok).toBe(true);
    expect(room.start(0).ok).toBe(false);
  });
});

describe("seat tokens", () => {
  it("never puts a token on the broadcast room info", () => {
    // RoomInfo goes to every socket at the table. A token is a bearer credential
    // for one seat, so one appearing here hands every opponent that seat.
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    const tokens = room.seats().map((p) => p.token);
    const serialized = JSON.stringify(room.info());
    for (const token of tokens) {
      expect(serialized).not.toContain(token);
    }
  });

  it("resolves a seat from its token and rejects an unknown one", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    const token = room.seats()[1].token;
    const resumed = room.resume(token);
    expect(resumed.ok && resumed.value.seat).toBe(1);
    expect(room.resume("not-a-real-token").ok).toBe(false);
  });

  it("marks a seat connected again on resume", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.setConnected(1, false);
    expect(room.info().players[1].connected).toBe(false);
    room.resume(room.seats()[1].token);
    expect(room.info().players[1].connected).toBe(true);
  });
});

describe("submitting actions", () => {
  it("rejects an action before the game has started", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.submitAction(0, { type: "draw" }).ok).toBe(false);
  });

  it("rejects an action from a seat that is not on turn", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    const wrongSeat = room.submitAction(1, { type: "draw" });
    expect(wrongSeat.ok).toBe(false);
    expect(wrongSeat.ok === false && wrongSeat.error).toContain("not your turn");
  });

  it("passes a rule violation back as a rejection rather than throwing", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    // Discarding in the draw phase is illegal; the engine says so as a value.
    const rejected = room.submitAction(0, { type: "discard", cardId: "nope" });
    expect(rejected.ok).toBe(false);
    expect(room.gameState?.phase).toBe("draw");
  });

  it("does not log a rejected action", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    room.submitAction(1, { type: "draw" });
    room.submitAction(0, { type: "discard", cardId: "nope" });
    expect(room.log.length).toBe(0);
  });

  it("logs an accepted action with its seat, source, and server time", () => {
    const clock = new FakeClock(5_000);
    const room = newRoom(EAST_COAST, clock);
    seated(room, ["ana", "ben"]);
    room.start(0);
    clock.advance(1_234);
    expect(room.submitAction(0, { type: "draw" }).ok).toBe(true);

    expect(room.log.entries()).toEqual([
      { seq: 0, seat: 0, action: { type: "draw" }, source: "player", at: 6_234 },
    ]);
  });

  it("records the source, so a forced move is distinguishable from a chosen one", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    room.submitAction(0, { type: "draw" }, "timeout");
    expect(room.log.entries()[0].source).toBe("timeout");
  });

  it("numbers log entries contiguously from zero", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    room.submitAction(0, { type: "draw" });
    const card = room.gameState!.players[0].hand[0];
    room.submitAction(0, { type: "discard", cardId: card.id });
    room.submitAction(1, { type: "draw" });
    expect(room.log.entries().map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(room.log.entries().map((e) => e.seat)).toEqual([0, 0, 1]);
  });
});

describe("pausing", () => {
  it("freezes the table and refuses actions until resumed", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    expect(room.setPaused(1, true).ok).toBe(true);
    expect(room.paused).toBe(true);

    const blocked = room.submitAction(0, { type: "draw" });
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.error).toContain("paused");

    expect(room.setPaused(1, false).ok).toBe(true);
    expect(room.submitAction(0, { type: "draw" }).ok).toBe(true);
  });

  it("lets the player on the clock pause their own turn", () => {
    // Deliberate: unrestricted pause in family mode, which makes the turn cap
    // soft here and hard in competitive play where pausing is off.
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    expect(room.gameState?.currentSeat).toBe(0);
    expect(room.setPaused(0, true).ok).toBe(true);
  });

  it("lets a different player resume than the one who paused", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    room.setPaused(0, true);
    expect(room.setPaused(1, false).ok).toBe(true);
    expect(room.paused).toBe(false);
  });

  it("reports who paused, and rejects redundant pause and resume", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.setPaused(1, true);
    expect(room.info().pausedBy).toBe(1);
    expect(room.setPaused(0, true).ok).toBe(false);
    room.setPaused(0, false);
    expect(room.info().pausedBy).toBeUndefined();
    expect(room.setPaused(0, false).ok).toBe(false);
  });

  it("refuses to pause at all in competitive mode", () => {
    const room = newRoom({ ...EAST_COAST, mode: "competitive", pauseEnabled: false });
    seated(room, ["ana", "ben"]);
    const refused = room.setPaused(0, true);
    expect(refused.ok).toBe(false);
    expect(room.paused).toBe(false);
  });

  it("rejects a pause from a seat that is not at the table", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.setPaused(7, true).ok).toBe(false);
  });
});

describe("projection and results", () => {
  it("has no view before the game starts", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.viewFor(0)).toBeNull();
    expect(room.result()).toBeNull();
  });

  it("gives each seat only its own hand", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    const mine = room.viewFor(0)!;
    const theirs = room.gameState!.players[1].hand.map((c) => c.id);
    const visible = JSON.stringify(mine.view);
    for (const id of theirs) expect(visible).not.toContain(id);
    expect(mine.view.hand).toHaveLength(EAST_COAST.handSize);
  });

  it("reports no deadline yet, since the turn clock lands in M2c", () => {
    const clock = new FakeClock(9_000);
    const room = newRoom(EAST_COAST, clock);
    seated(room, ["ana", "ben"]);
    room.start(0);
    expect(room.clockState()).toEqual({
      serverNow: 9_000,
      deadlineAt: null,
      inDiscardGrace: false,
      paused: false,
    });
  });

  it("has a custom log injected when one is supplied", () => {
    const log = new InMemoryActionLog();
    const room = new Room("XYZ", EAST_COAST, {
      clock: new FakeClock(),
      seed: 1,
      newToken: () => "t",
      log,
    });
    seated(room, ["ana", "ben"]);
    room.start(0);
    room.submitAction(0, { type: "draw" });
    expect(log.length).toBe(1);
  });
});
