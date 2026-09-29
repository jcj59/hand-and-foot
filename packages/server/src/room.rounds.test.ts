/**
 * The rounds of a match at one table: the result after each, getting ready for the
 * next, dealing it once everyone is, and the end of the match after the last.
 */
import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { defaultAction, scoreRound } from "@hf/engine";
import { FakeClock } from "./clock";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";

/** Short rounds: no extra decks, and a round ends when the stock does. */
const SHORT: RulesConfig = { ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" };

function table(
  names: readonly string[],
  store?: InMemoryRoomStore,
): { room: Room; clock: FakeClock } {
  const clock = new FakeClock();
  let token = 0;
  const room = new Room("ROUNDS", SHORT, { clock, seed: 21, newToken: () => `t${token++}`, store });
  store?.saveRoom(room.record());
  for (const name of names) expect(room.join(name).ok).toBe(true);
  expect(room.start(0).ok).toBe(true);
  return { room, clock };
}

/** Play the safe default for every seat until the round is over. */
function finishRound(room: Room): void {
  for (let guard = 0; !room.gameState!.roundEnded; guard++) {
    expect(guard).toBeLessThan(2_000);
    const state = room.gameState!;
    expect(room.submitAction(state.currentSeat, defaultAction(state)!).ok).toBe(true);
  }
}

/** Everyone says ready, so the next round is dealt. */
function everyoneReady(room: Room): void {
  const seats = room.seats().filter((p) => !p.left);
  seats.forEach((p) => room.readyForNextRound(p.seat));
}

describe("the end of a round", () => {
  it("reports the round, the running totals, and that the match goes on", () => {
    const { room } = table(["ana", "ben"]);
    finishRound(room);
    const result = room.result()!;
    expect(result.roundNumber).toBe(1);
    expect(result.matchOver).toBe(false);
    expect(result.totals).toEqual(scoreRound(room.gameState!).map((r) => r.score));
  });
});

describe("getting ready for the next round", () => {
  it("shows who is ready, and deals once everyone is", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    expect(room.readyForNextRound(2)).toEqual({ ok: true, value: false });
    expect(room.readyForNextRound(0)).toEqual({ ok: true, value: false });
    expect(room.info().nextRoundReady).toEqual([0, 2]);
    expect(room.gameState!.roundNumber).toBe(1);

    expect(room.readyForNextRound(1)).toEqual({ ok: true, value: true });
    const state = room.gameState!;
    expect(state.roundNumber).toBe(2);
    expect(state.roundEnded ?? false).toBe(false);
    // The first turn has moved on a seat, and its clock is running.
    expect(state.currentSeat).toBe(1);
    expect(room.clockState().deadlineAt).not.toBeNull();
    expect(room.info().nextRoundReady).toEqual([]);
    expect(room.log.entries().at(-1)!.action).toEqual({ type: "nextRound" });
  });

  it("refuses the next round as an ordinary move, so no one deals past the others' ready", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    const seat = room.gameState!.currentSeat;
    const logged = room.log.entries().length;
    expect(room.submitAction(seat, { type: "nextRound" })).toEqual({
      ok: false,
      error: "the next round is dealt when everyone is ready",
    });
    expect(room.gameState!.roundNumber).toBe(1);
    expect(room.gameState!.roundEnded).toBe(true);
    expect(room.log.entries()).toHaveLength(logged);
  });

  it("counts a player ready once however many times they say so", () => {
    const { room } = table(["ana", "ben"]);
    finishRound(room);
    room.readyForNextRound(0);
    expect(room.readyForNextRound(0)).toEqual({ ok: true, value: false });
    expect(room.info().nextRoundReady).toEqual([0]);
  });

  it("does not wait for a player who has left", () => {
    const { room } = table(["ana", "ben", "cy"]);
    finishRound(room);
    room.readyForNextRound(0);
    room.readyForNextRound(2);
    // Ben goes home rather than getting ready; that was all anyone was waiting on.
    expect(room.leave("t1").ok).toBe(true);
    expect(room.gameState!.roundNumber).toBe(2);
  });

  it("is refused while a round is being played, and after the last one", () => {
    const { room } = table(["ana", "ben"]);
    expect(room.readyForNextRound(0)).toEqual({
      ok: false,
      error: "the round is still being played",
    });
    for (let round = 1; round < 4; round++) {
      finishRound(room);
      everyoneReady(room);
    }
    finishRound(room);
    expect(room.gameState!.roundNumber).toBe(4);
    expect(room.result()!.matchOver).toBe(true);
    expect(room.matchOver).toBe(true);
    expect(room.readyForNextRound(0)).toEqual({ ok: false, error: "that was the last round" });
  });

  it("adds each round into the totals", () => {
    const { room } = table(["ana", "ben"]);
    finishRound(room);
    const first = room.result()!.totals;
    everyoneReady(room);
    // Mid-round, the view carries the finished rounds' totals.
    expect(room.viewFor(0)!.view.scoresSoFar).toEqual(first);
    finishRound(room);
    const second = scoreRound(room.gameState!).map((r) => r.score);
    expect(room.result()!.totals).toEqual(first.map((total, i) => total + second[i]!));
  });

  it("lets nobody move on to a new game until the match is over", () => {
    const { room } = table(["ana", "ben"]);
    finishRound(room);
    expect(room.moveOn("t0")).toEqual({ ok: false, error: "the match is not over yet" });
  });
});

describe("a restart part way through a match", () => {
  it("replays every round so far, and goes on from there", async () => {
    const store = new InMemoryRoomStore();
    const { room } = table(["ana", "ben"], store);
    finishRound(room);
    everyoneReady(room);
    const state = room.gameState!;
    expect(state.roundNumber).toBe(2);

    const [stored] = await store.loadOpen();
    const restored = Room.restore(stored!, { clock: new FakeClock(), newToken: () => "x" });
    expect(restored.ok && restored.value.gameState).toEqual(state);
  });
});
