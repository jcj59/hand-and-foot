/**
 * Saving a game to finish another day: mid-turn or between rounds, with everyone
 * free to go, and picked back up by the host once the players are back.
 */
import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { FakeClock } from "./clock";
import { Room, SAVED_TABLE_MS } from "./room";

const T0 = 1_700_000_000_000;
const { baseMs } = EAST_COAST.timers;
const GRACE = 30_000;

function started(config: RulesConfig = EAST_COAST): { room: Room; clock: FakeClock } {
  const clock = new FakeClock(T0);
  let tokens = 0;
  const room = new Room("SAVE23", config, {
    clock,
    seed: 11,
    newToken: () => `tok-${tokens++}`,
    reconnectGraceMs: GRACE,
    pauseWhenIdle: false,
  });
  room.join("ana");
  room.join("ben");
  room.join("cy");
  room.start(0);
  return { room, clock };
}

/** Draw and discard by hand until the stock runs out and ends the round. */
function playOutRound(config: RulesConfig = EAST_COAST): { room: Room; clock: FakeClock } {
  const { room, clock } = started({
    ...config,
    extraDecks: 0,
    stockExhaustion: "end",
  });
  for (let guard = 0; !room.gameState!.roundEnded; guard++) {
    expect(guard).toBeLessThan(2_000);
    const state = room.gameState!;
    const seat = state.currentSeat;
    if (state.phase === "draw") room.submitAction(seat, { type: "draw" });
    else {
      const card = state.players[seat]!.hand[0] ?? state.players[seat]!.foot[0]!;
      room.submitAction(seat, { type: "discard", cardId: card.id });
    }
  }
  return { room, clock };
}

describe("saving a game for later", () => {
  it("pauses a table mid-turn in the same step, so no clock runs while it is put away", () => {
    const { room, clock } = started();
    const seat = room.gameState!.currentSeat;
    clock.advance(10_000);
    expect(room.saveForLater(2)).toEqual({ ok: true, value: undefined });
    expect(room.info()).toMatchObject({ pausedBy: 2, savedUntil: T0 + 10_000 + SAVED_TABLE_MS });
    expect(room.clockState()).toMatchObject({ paused: true, deadlineAt: null });
    // Days go by and nobody's turn is played for them.
    clock.advance(3 * 24 * 60 * 60_000);
    expect(room.gameState!.currentSeat).toBe(seat);
    // The turn picks up with the time it had left, not a fresh one or none.
    room.setPaused(0, false);
    expect(room.clockState().deadlineAt).toBe(clock.now() + baseMs - 10_000);
  });

  it("keeps who paused a table that was already paused", () => {
    const { room } = started();
    room.setPaused(1, true);
    expect(room.saveForLater(2).ok).toBe(true);
    expect(room.info().pausedBy).toBe(1);
  });

  it("saves between rounds, and the next round waits for the game to be picked up", () => {
    const { room } = playOutRound();
    expect(room.readyForNextRound(1)).toEqual({ ok: true, value: false });
    expect(room.saveForLater(1).ok).toBe(true);
    // Whoever had said ready says so again once they are back and have seen the scores.
    expect(room.info().nextRoundReady).toEqual([]);
    expect(room.readyForNextRound(0)).toEqual({
      ok: false,
      error: "the game is saved; the host picks it back up",
    });
    room.setPaused(0, false);
    expect(room.readyForNextRound(0).ok).toBe(true);
    expect(room.readyForNextRound(1).ok).toBe(true);
    expect(room.readyForNextRound(2)).toEqual({ ok: true, value: true });
    expect(room.gameState!.roundNumber).toBe(2);
  });

  it("does not deal the next round when everyone leaves a game saved between rounds", () => {
    const { room } = playOutRound();
    room.saveForLater(0);
    for (const token of ["tok-0", "tok-1", "tok-2"]) expect(room.leave(token).ok).toBe(true);
    expect(room.gameState!.roundEnded).toBe(true);
    expect(room.gameState!.roundNumber).toBe(1);
  });

  it("refuses to save a finished match", () => {
    const { room } = playOutRound({ ...EAST_COAST, rounds: 1, layDownMinimums: [60] });
    expect(room.matchOver).toBe(true);
    expect(room.saveForLater(0)).toEqual({
      ok: false,
      error: "the game is over; there is nothing to save",
    });
  });
});

describe("leaving and coming back to a saved game", () => {
  it("keeps the seat of a player who leaves, so it is not played the moment the game resumes", () => {
    const { room, clock } = started();
    const seat = room.gameState!.currentSeat;
    room.saveForLater(0);
    expect(room.leave(`tok-${seat}`).ok).toBe(true);
    expect(room.seats()[seat]).toMatchObject({ left: false, connected: false });
    // Back a week later — well, six days — and the host picks it up without them.
    clock.advance(6 * 24 * 60 * 60_000);
    if (seat !== 0) room.resume("tok-0");
    expect(room.setPaused(seat === 0 ? 1 : 0, false).ok).toBe(true);
    // They get a reconnect grace from the resume, as a dropped player would.
    clock.advance(GRACE - 1);
    expect(room.gameState!.currentSeat).toBe(seat);
    expect(room.gameState!.phase).toBe("draw");
    // And coming back gives them the seat as it was.
    expect(room.resume(`tok-${seat}`).ok).toBe(true);
    expect(room.seats()[seat]).toMatchObject({ left: false, connected: true });
  });

  it("is picked back up by the host while the host is at the table", () => {
    const { room } = started();
    room.saveForLater(1);
    expect(room.setPaused(1, false)).toEqual({
      ok: false,
      error: "only the host can pick a saved game back up",
    });
    expect(room.paused).toBe(true);
    expect(room.setPaused(0, false).ok).toBe(true);
    expect(room.info()).toMatchObject({ savedUntil: null, pausedBy: undefined });
  });

  it("lets anyone pick it back up when the host has not come back", () => {
    const { room } = started();
    room.saveForLater(0);
    room.leave("tok-0");
    expect(room.setPaused(2, false).ok).toBe(true);
    expect(room.paused).toBe(false);
  });

  it("still lets anyone resume an ordinary pause", () => {
    const { room } = started();
    room.setPaused(0, true);
    expect(room.setPaused(2, false).ok).toBe(true);
  });

  it("gives up the seat as before when the game is not saved", () => {
    const { room } = started();
    room.setPaused(0, true);
    room.leave("tok-1");
    expect(room.seats()[1]).toMatchObject({ left: true });
  });
});
