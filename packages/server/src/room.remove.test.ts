/**
 * Carrying on without a player between rounds of a family game: one who leaves
 * the table, one who walked away mid-round, and one the host lets go.
 */
import { describe, it, expect } from "vitest";
import { baseRules, EAST_COAST, type RulesConfig } from "@hf/shared";
import { buildShoe, defaultAction, scoreRound } from "@hf/engine";
import { FakeClock } from "./clock";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";

/** Short rounds: no extra decks, and a round ends when the stock does. */
const SHORT: RulesConfig = { ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" };
const COMPETITIVE: RulesConfig = {
  ...baseRules("east-coast", "competitive"),
  extraDecks: 0,
  stockExhaustion: "end",
};

const T0 = 1_700_000_000_000;

function table(
  names: readonly string[],
  { config = SHORT, store }: { config?: RulesConfig; store?: InMemoryRoomStore } = {},
): { room: Room; clock: FakeClock } {
  const clock = new FakeClock(T0);
  let token = 0;
  // Seed 21 starts at seat 0, so the host deals and moves first.
  const room = new Room("LEAVE2", config, {
    clock,
    seed: 21,
    newToken: () => `t${token++}`,
    store,
    pauseWhenIdle: false,
  });
  store?.saveRoom(room.record());
  for (const name of names) expect(room.join(name).ok).toBe(true);
  expect(room.start(0).ok).toBe(true);
  return { room, clock };
}

/** Play the safe default for every seat until the round is over. */
function finishRound(room: Room): void {
  for (let guard = 0; !room.gameState!.roundEnded; guard++) {
    expect(guard).toBeLessThan(3_000);
    const state = room.gameState!;
    expect(room.submitAction(state.currentSeat, defaultAction(state)!).ok).toBe(true);
  }
}

function dealtTo(room: Room): number[] {
  return room
    .gameState!.players.flatMap((p, seat) => (p.hand.length > 0 ? [seat] : []))
    .sort((a, b) => a - b);
}

describe("leaving a family game between rounds", () => {
  it("takes the player out of the match, and deals the next round without them", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    const ended = room.gameState!;
    room.readyForNextRound(0);
    expect(room.leave("t1").ok).toBe(true);
    expect(room.gameState!.departed).toEqual([{ seat: 1, afterRound: 1 }]);
    expect(room.log.entries().at(-1)).toMatchObject({
      action: { type: "removePlayer", seat: 1 },
      source: "player",
    });
    // The scoreboard still has their round, and says they have gone.
    expect(room.result()!.scores).toEqual(scoreRound(ended));
    expect(room.result()!.departed).toEqual([{ seat: 1, afterRound: 1 }]);
    expect(room.info().players.map((p) => p.departed ?? false)).toEqual([false, true, false]);

    // Cy is the last one anyone is waiting on now.
    expect(room.readyForNextRound(2)).toEqual({ ok: true, value: true });
    const two = room.gameState!;
    expect(two.roundNumber).toBe(2);
    expect(dealtTo(room)).toEqual([0, 2]);
    // The first turn goes on from Ana, past Ben's empty seat.
    expect(two.currentSeat).toBe(2);
    const cards = two.stock.length + two.discard.length + 2 * (SHORT.handSize + SHORT.footSize);
    expect(cards).toBe(buildShoe(2, 0).length);
  });

  it("never gives the leaver a turn, nor waits for them, for the rest of the match", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    room.leave("t1");
    for (let round = 2; round <= SHORT.rounds; round++) {
      room.readyForNextRound(0);
      expect(room.readyForNextRound(2)).toEqual({ ok: true, value: true });
      for (let guard = 0; !room.gameState!.roundEnded; guard++) {
        expect(guard).toBeLessThan(3_000);
        const state = room.gameState!;
        expect(state.currentSeat).not.toBe(1);
        expect(room.submitAction(state.currentSeat, defaultAction(state)!).ok).toBe(true);
      }
    }
    expect(room.matchOver).toBe(true);
    // Ben's total is what he scored in the one round he played.
    expect(room.result()!.totals[1]).toBe(room.gameState!.pastRounds![0]![1]!.score);
  });

  it("refuses the leaver's seat back: the game carried on without them", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    room.leave("t1");
    expect(room.resume("t1")).toEqual({ ok: false, error: "the game carried on without you" });
    expect(room.seatOf("t1")!.connected).toBe(false);
  });

  it("hands hosting on to the next player when the host leaves", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    room.leave("t0");
    expect(room.hostSeat).toBe(1);
  });

  it("hands hosting round from the last seat to the first player still in", () => {
    const clock = new FakeClock(T0);
    let token = 0;
    const room = new Room("HOST23", SHORT, { clock, seed: 21, newToken: () => `t${token++}` });
    for (const name of ["ana", "ben", "cy", "di"]) room.join(name);
    expect(room.setHost(0, 3).ok).toBe(true);
    expect(room.start(3).ok).toBe(true);
    finishRound(room);
    room.leave("t0");
    room.leave("t3");
    expect(room.gameState!.departed).toEqual([
      { seat: 0, afterRound: 1 },
      { seat: 3, afterRound: 1 },
    ]);
    expect(room.hostSeat).toBe(1);
  });

  it("lets the pause go with the player who made it", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    expect(room.setPaused(1, true).ok).toBe(true);
    room.leave("t1");
    expect(room.paused).toBe(false);
  });

  it("is a plain leave at a competitive table: the seat stays and is played for", () => {
    const { room } = table(["ana", "ben", "cy"], { config: COMPETITIVE });
    finishRound(room);
    room.leave("t1");
    expect(room.gameState!.departed).toBeUndefined();
    expect(room.seatOf("t1")!.left).toBe(true);
    room.readyForNextRound(0);
    expect(room.readyForNextRound(2)).toEqual({ ok: true, value: true });
    expect(dealtTo(room)).toEqual([0, 1, 2]);
  });

  it("is a plain leave when it would leave one player", () => {
    const { room } = table(["ana", "ben"]);
    finishRound(room);
    room.leave("t1");
    expect(room.gameState!.departed).toBeUndefined();
    expect(room.readyForNextRound(0)).toEqual({ ok: true, value: true });
    expect(dealtTo(room)).toEqual([0, 1]);
  });

  it("only disconnects while the game is saved: everyone is coming back", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    expect(room.saveForLater(0).ok).toBe(true);
    room.leave("t1");
    expect(room.gameState!.departed).toBeUndefined();
    expect(room.resume("t1").ok).toBe(true);
  });
});

describe("walking away from a family game mid-round", () => {
  it("is played for until the round is over, and then taken out of the match", () => {
    const { room } = table(["ana", "ben", "cy"]);
    room.leave("t1");
    expect(room.gameState!.departed).toBeUndefined();
    finishRound(room);
    expect(room.gameState!.departed).toEqual([{ seat: 1, afterRound: 1 }]);
    expect(room.log.entries().at(-1)!.action).toEqual({ type: "removePlayer", seat: 1 });
    room.readyForNextRound(0);
    expect(room.readyForNextRound(2)).toEqual({ ok: true, value: true });
    expect(dealtTo(room)).toEqual([0, 2]);
  });

  it("ends a round the clock plays out with the leaver gone too", () => {
    const { room, clock } = table(["ana", "ben", "cy"]);
    room.leave("t1");
    room.leave("t2");
    // Everyone but Ana has walked away; play her turns and let the server play theirs.
    for (let guard = 0; !room.gameState!.roundEnded; guard++) {
      expect(guard).toBeLessThan(3_000);
      const state = room.gameState!;
      if (state.currentSeat === 0) room.submitAction(0, defaultAction(state)!);
      else clock.advance(0);
    }
    // Only one of them can go: two players are the fewest a game is dealt to.
    expect(room.gameState!.departed).toEqual([{ seat: 1, afterRound: 1 }]);
    expect(room.seatOf("t2")!.left).toBe(true);
  });

  it("keeps a competitive leaver in the match, played for", () => {
    const { room } = table(["ana", "ben", "cy"], { config: COMPETITIVE });
    room.leave("t1");
    finishRound(room);
    expect(room.gameState!.departed).toBeUndefined();
  });

  it("is forgiven if they come back before the round is over", () => {
    const { room } = table(["ana", "ben", "cy"]);
    room.leave("t1");
    expect(room.resume("t1").ok).toBe(true);
    finishRound(room);
    expect(room.gameState!.departed).toBeUndefined();
  });
});

describe("the host carrying on without a player", () => {
  function ended(): Room {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    return room;
  }

  it("takes a player who has gone out of the match", () => {
    const room = ended();
    room.setConnected(2, false);
    room.readyForNextRound(0);
    room.readyForNextRound(1);
    // Everyone still here was ready: carrying on deals the next round at once.
    expect(room.removePlayer(0, 2)).toEqual({ ok: true, value: undefined });
    expect(room.gameState!.roundNumber).toBe(2);
    expect(room.gameState!.departed).toEqual([{ seat: 2, afterRound: 1 }]);
    expect(dealtTo(room)).toEqual([0, 1]);
    expect(room.resume("t2").ok).toBe(false);
  });

  it("stops counting them as ready", () => {
    const room = ended();
    room.readyForNextRound(2);
    room.setConnected(2, false);
    expect(room.info().nextRoundReady).toEqual([2]);
    expect(room.removePlayer(0, 2).ok).toBe(true);
    expect(room.info().nextRoundReady).toEqual([]);
  });

  it("is the host's call alone", () => {
    const room = ended();
    room.setConnected(2, false);
    expect(room.removePlayer(1, 2)).toEqual({
      ok: false,
      error: "only the host can carry on without a player",
    });
    expect(room.gameState!.departed).toBeUndefined();
  });

  it("is refused for someone still at the table", () => {
    const room = ended();
    expect(room.removePlayer(0, 2)).toEqual({ ok: false, error: "cy is still at the table" });
  });

  it("is refused for the host themselves, who leaves the table instead", () => {
    const room = ended();
    expect(room.removePlayer(0, 0)).toEqual({
      ok: false,
      error: "to leave the game yourself, leave the table",
    });
  });

  it("is refused for a seat nobody holds, or one already gone", () => {
    const room = ended();
    room.setConnected(2, false);
    for (const seat of [3, -1, Number.NaN]) {
      expect(room.removePlayer(0, seat)).toEqual({ ok: false, error: "there is no such player" });
    }
    expect(room.removePlayer(0, 2).ok).toBe(true);
    expect(room.removePlayer(0, 2)).toEqual({ ok: false, error: "there is no such player" });
  });

  it("is refused mid-round, at a competitive table, and before the deal", () => {
    const { room } = table(["ana", "ben", "cy"]);
    room.setConnected(2, false);
    expect(room.removePlayer(0, 2)).toEqual({
      ok: false,
      error: "a player can only leave between rounds",
    });
    const competitive = table(["ana", "ben", "cy"], { config: COMPETITIVE }).room;
    finishRound(competitive);
    competitive.setConnected(2, false);
    expect(competitive.removePlayer(0, 2)).toEqual({
      ok: false,
      error: "only a family game can carry on without a player",
    });
    const lobby = new Room("LOBBY2", SHORT, {
      clock: new FakeClock(),
      seed: 1,
      newToken: () => "x",
    });
    expect(lobby.removePlayer(0, 1)).toEqual({ ok: false, error: "the game has not started" });
  });

  it("is never a move a player can submit", () => {
    const room = ended();
    expect(
      room.submitAction(room.gameState!.currentSeat, { type: "removePlayer", seat: 2 }),
    ).toEqual({ ok: false, error: "players leave the game by leaving the table" });
  });
});

describe("a smaller table across a restart", () => {
  it("replays the departure, and still refuses the leaver's seat", async () => {
    const store = new InMemoryRoomStore();
    const { room } = table(["ana", "ben", "cy"], { store });
    finishRound(room);
    room.leave("t1");
    room.readyForNextRound(0);
    room.readyForNextRound(2);
    const state = room.gameState!;
    expect(state.roundNumber).toBe(2);

    const [stored] = await store.loadOpen();
    const restored = Room.restore(stored!, { clock: new FakeClock(), newToken: () => "x" });
    if (!restored.ok) throw new Error(restored.error);
    const back = restored.value;
    expect(back.gameState).toEqual(state);
    expect(back.info().players.map((p) => p.departed ?? false)).toEqual([false, true, false]);
    expect(back.resume("t1").ok).toBe(false);
    expect(back.resume("t2").ok).toBe(true);
  });

  it("restores a table between rounds after someone left, still waiting on the rest", async () => {
    const store = new InMemoryRoomStore();
    const { room } = table(["ana", "ben", "cy"], { store });
    finishRound(room);
    room.readyForNextRound(0);
    room.leave("t1");
    const [stored] = await store.loadOpen();
    const restored = Room.restore(stored!, { clock: new FakeClock(), newToken: () => "x" });
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.value.info().nextRoundReady).toEqual([0]);
    expect(restored.value.readyForNextRound(2)).toEqual({ ok: true, value: true });
    expect(restored.value.gameState!.departed).toEqual([{ seat: 1, afterRound: 1 }]);
  });
});

describe("a table that pauses itself", () => {
  it("counts a lap by the players still in the match", () => {
    const clock = new FakeClock(T0);
    let token = 0;
    const room = new Room("IDLE45", SHORT, { clock, seed: 21, newToken: () => `t${token++}` });
    for (const name of ["ana", "ben", "cy"]) room.join(name);
    room.start(0);
    finishRound(room);
    room.leave("t1");
    room.readyForNextRound(0);
    room.readyForNextRound(2);
    // Two turns played for nobody is a whole lap at a table of two.
    const { baseMs, discardGraceMs } = SHORT.timers;
    for (let turn = 0; turn < 2; turn++) {
      expect(room.paused).toBe(false);
      const seat = room.gameState!.currentSeat;
      for (let guard = 0; room.gameState!.currentSeat === seat && !room.paused; guard++) {
        expect(guard).toBeLessThan(10);
        clock.advance(baseMs + discardGraceMs);
      }
    }
    expect(room.paused).toBe(true);
  });
});
