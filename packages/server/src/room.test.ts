import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { legalHints } from "@hf/engine";
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

describe("leaving the lobby", () => {
  it("frees the seat and closes the gap behind it", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    const cyToken = room.seats()[2].token;
    const left = room.leave(room.seats()[1].token);
    expect(left.ok && left.value.name).toBe("ben");
    expect(room.info().players).toEqual([
      { seat: 0, name: "ana", connected: true },
      { seat: 1, name: "cy", connected: true },
    ]);
    // The token is what survives a renumbering; it now resolves to the new seat.
    expect(room.seatOf(cyToken)?.seat).toBe(1);
  });

  it("lets someone else take the freed seat", () => {
    const room = newRoom();
    seated(
      room,
      Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i}`),
    );
    expect(room.join("waiting").ok).toBe(false);
    const leaver = room.seats()[3].token;
    expect(room.leave(leaver).ok).toBe(true);
    const joined = room.join("waiting");
    expect(joined.ok && joined.value.seat).toBe(MAX_PLAYERS - 1);
    // The departed token is gone for good, not parked on a seat.
    expect(room.resume(leaver).ok).toBe(false);
  });

  it("deals only the players still seated", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    room.leave(room.seats()[2].token);
    expect(room.start(0).ok).toBe(true);
    expect(room.gameState!.players).toHaveLength(2);
  });

  it("hands the host to the next seat when the host leaves", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    room.leave(room.seats()[0].token);
    expect(room.info().hostSeat).toBe(0);
    expect(room.info().players[0].name).toBe("ben");
    expect(room.start(0).ok).toBe(true);
  });

  it("leaves the room reapable once the last player goes", () => {
    const room = newRoom();
    seated(room, ["ana"]);
    expect(room.abandonedSince).toBeNull();
    room.leave(room.seats()[0].token);
    expect(room.seatCount).toBe(0);
    expect(room.abandonedSince).toBe(room.createdAt);
  });

  it("lifts the pause when the player holding it leaves", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.setPaused(0, true).ok).toBe(true);
    room.leave(room.seats()[0].token);
    // Otherwise the pause would be credited to ben, who moved up into seat 0.
    expect(room.paused).toBe(false);
    expect(room.info().pausedBy).toBeUndefined();
    expect(room.setPaused(0, true).ok).toBe(true);
  });

  it("moves the pause down with its holder when a lower seat leaves", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.setPaused(1, true).ok).toBe(true);
    room.leave(room.seats()[0].token);
    expect(room.info().pausedBy).toBe(0);
    expect(room.info().players[0].name).toBe("ben");
  });

  it("leaves the pause where it is when a higher seat leaves", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    expect(room.setPaused(0, true).ok).toBe(true);
    room.leave(room.seats()[2].token);
    expect(room.info().pausedBy).toBe(0);
  });

  it("refuses a token that is not at the table", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.leave("not-a-real-token").ok).toBe(false);
    expect(room.seatCount).toBe(2);
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

  it("sends each seat the hints for that seat, not the seat on turn", () => {
    // The whole point of shipping hints is that the client cannot derive them:
    // canTakePile and canGoOut read the full state. Computing them for the wrong
    // seat would both mislead the receiver and tell them something about another
    // player's hand, so the seat has to be threaded through correctly.
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    const onTurn = room.viewFor(0)!;
    const waiting = room.viewFor(1)!;

    expect(onTurn.hints).toEqual(legalHints(room.gameState!, 0));
    expect(waiting.hints).toEqual(legalHints(room.gameState!, 1));
    // Seat 0 opens the round, so only it may act.
    expect(onTurn.hints.seatToAct).toBe(0);
    expect(onTurn.hints.canDraw).toBe(true);
    expect(waiting.hints.canDraw).toBe(false);
  });

  it("keeps hints free of any card identity, so they cannot leak a hand", () => {
    // Hints are booleans, a seat number and a list of ranks. If a card id ever
    // appeared in one it would be a hole in the same boundary `view` defends.
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    const everyCardId = room
      .gameState!.players.flatMap((p) => [...p.hand, ...p.foot])
      .map((c) => c.id);
    for (const seat of [0, 1]) {
      const serialized = JSON.stringify(room.viewFor(seat)!.hints);
      for (const id of everyCardId) expect(serialized).not.toContain(id);
    }
  });

  it("tells only the seat on turn why it cannot take the pile", () => {
    // About the player's own cards and the face-up pile: told to them, and not to
    // anyone else, whose own hints say nothing about another seat's hand.
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    // Play on until a turn opens where the seat on turn cannot take the pile.
    for (
      let guard = 0;
      legalHints(room.gameState!, room.gameState!.currentSeat).canTakePile;
      guard++
    ) {
      expect(guard).toBeLessThan(50);
      const seat = room.gameState!.currentSeat;
      room.submitAction(seat, { type: "draw" });
      room.submitAction(seat, {
        type: "discard",
        cardId: room.gameState!.players[seat]!.hand[0]!.id,
      });
    }
    const state = room.gameState!;
    const onTurn = state.currentSeat;
    expect(room.viewFor(onTurn)!.hints.takePileWhy).toBe(legalHints(state, onTurn).takePileWhy);
    expect(room.viewFor(onTurn)!.hints.takePileWhy).toMatch(/^(none of the pile|with the pile)/);
    expect("takePileWhy" in room.viewFor(1 - onTurn)!.hints).toBe(false);
  });

  it("moves the hints along with the turn", () => {
    // Pinned because a stale hint is worse than no hint: a client that still
    // believes it may draw will offer an action the reducer now refuses.
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    room.start(0);
    room.submitAction(0, { type: "draw" });
    expect(room.viewFor(0)!.hints.phase).toBe("play");
    expect(room.viewFor(0)!.hints.canDraw).toBe(false);
    room.submitAction(0, { type: "discard", cardId: room.gameState!.players[0].hand[0].id });
    expect(room.viewFor(1)!.hints.seatToAct).toBe(1);
    expect(room.viewFor(1)!.hints.canDraw).toBe(true);
    expect(room.viewFor(0)!.hints.canDraw).toBe(false);
  });

  it("reports no deadline before the game starts", () => {
    const clock = new FakeClock(9_000);
    const room = newRoom(EAST_COAST, clock);
    seated(room, ["ana", "ben"]);
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

describe("moving on to the next game", () => {
  it("is refused before the round is over, and for a token that is not here", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.moveOn("token-0")).toEqual({ ok: false, error: "the match is not over yet" });
    room.start(0);
    const state = room.gameState!;
    Object.assign(room as unknown as { state: typeof state }, {
      state: { ...state, roundEnded: true, roundNumber: state.config.rounds },
    });
    expect(room.moveOn("nobody").ok).toBe(false);
    expect(room.info().playAgain).toEqual([]);
    expect(room.moveOn("token-1").ok).toBe(true);
    expect(room.info().playAgain).toEqual([1]);
  });
});

describe("handing hosting on", () => {
  it("lets the host give the deal to another player, without moving any seat", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    expect(room.setHost(0, 2)).toEqual({ ok: true, value: undefined });
    expect(room.hostSeat).toBe(2);
    expect(room.info().hostSeat).toBe(2);
    expect(room.seats().map((p) => p.name)).toEqual(["ana", "ben", "cy"]);
    // And the new host is the one who may deal.
    expect(room.start(0).ok).toBe(false);
    expect(room.start(2).ok).toBe(true);
  });

  it("is only the host's to give, only to someone seated, and only before the deal", () => {
    const room = newRoom();
    seated(room, ["ana", "ben"]);
    expect(room.setHost(1, 1)).toEqual({
      ok: false,
      error: "only the host can hand hosting to someone else",
    });
    expect(room.setHost(0, 5)).toEqual({ ok: false, error: "no such seat" });
    room.start(0);
    expect(room.setHost(0, 1)).toEqual({
      ok: false,
      error: "the host can only be changed before the deal",
    });
  });

  it("follows the host when others ahead of them leave the lobby", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    room.setHost(0, 2);
    room.leave("token-0");
    // cy moved from seat 2 to 1, and still hosts.
    expect(room.hostSeat).toBe(1);
    expect(room.seats()[1]!.name).toBe("cy");
  });

  it("names seat 0 while nobody has sat down, and after the last one leaves", () => {
    const room = newRoom();
    expect(room.hostSeat).toBe(0);
    seated(room, ["ana"]);
    room.leave("token-0");
    expect(room.hostSeat).toBe(0);
  });

  it("passes to the first seat when the host leaves the lobby", () => {
    const room = newRoom();
    seated(room, ["ana", "ben", "cy"]);
    room.setHost(0, 1);
    room.leave("token-1");
    expect(room.hostSeat).toBe(0);
    expect(room.seats()[0]!.name).toBe("ana");
  });
});
