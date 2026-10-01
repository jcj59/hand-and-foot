/**
 * Keeping a table open only while someone is playing it: a table pauses itself
 * after a lap nobody played, a paused table is closed after half an hour, and a
 * family table can be saved for later to be kept for a week instead.
 */
import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { FakeClock } from "./clock";
import { configFor, RoomManager } from "./manager";
import { PAUSED_TABLE_MS, Room, SAVED_TABLE_MS } from "./room";
import { InMemoryRoomStore } from "./store";

const T0 = 1_700_000_000_000;
const { baseMs, discardGraceMs } = EAST_COAST.timers;
/** Long enough for the seat on turn to run out of time, grace and all. */
const WHOLE_TURN = baseMs + discardGraceMs;
const COMPETITIVE: RulesConfig = configFor({ mode: "competitive" });

function started(
  config: RulesConfig = EAST_COAST,
  store?: InMemoryRoomStore,
): { room: Room; clock: FakeClock } {
  const clock = new FakeClock(T0);
  let tokens = 0;
  const room = new Room("IDLE23", config, {
    clock,
    seed: 11,
    newToken: () => `tok-${tokens++}`,
    store,
  });
  store?.saveRoom(room.record());
  room.join("ana");
  room.join("ben");
  room.start(0);
  return { room, clock };
}

/** Let the clock take the turn of whoever is on it. */
function timeOut(room: Room, clock: FakeClock): void {
  const seat = room.gameState!.currentSeat;
  for (let guard = 0; room.gameState!.currentSeat === seat && !room.paused; guard++) {
    expect(guard).toBeLessThan(10);
    clock.advance(WHOLE_TURN);
  }
}

/**
 * Play by hand to the last card of the stock, then let the clock play out the
 * round: ana's turn runs out on her and ben, gone, has his whole turn played for
 * him, which ends the round on the same turn that completes a lap nobody played.
 */
function endRoundOnClockPlayedTurns(): { room: Room; clock: FakeClock } {
  const { room, clock } = started({ ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" });
  const done = (): boolean => {
    const state = room.gameState!;
    return state.stock.length === 1 && state.phase === "draw" && state.currentSeat === 0;
  };
  for (let guard = 0; !done(); guard++) {
    expect(guard).toBeLessThan(2_000);
    const state = room.gameState!;
    const seat = state.currentSeat;
    if (state.phase === "draw") room.submitAction(seat, { type: "draw" });
    else {
      const card = state.players[seat]!.hand[0] ?? state.players[seat]!.foot[0]!;
      room.submitAction(seat, { type: "discard", cardId: card.id });
    }
  }
  room.setConnected(1, false);
  for (let guard = 0; !room.gameState!.roundEnded; guard++) {
    expect(guard).toBeLessThan(10);
    clock.advance(WHOLE_TURN);
  }
  return { room, clock };
}

describe("a table nobody is playing", () => {
  it("pauses itself once every seat's turn in a row has been played for it", () => {
    const { room, clock } = started();
    timeOut(room, clock);
    expect(room.paused).toBe(false);
    timeOut(room, clock);
    expect(room.paused).toBe(true);
    expect(room.info()).toMatchObject({ idlePaused: true, pausedBy: undefined });
    expect(room.clockState()).toMatchObject({ paused: true, deadlineAt: null });
    // And nothing more is played: no timer is left to fire.
    const moves = room.log.length;
    clock.advance(WHOLE_TURN * 10);
    expect(room.log.length).toBe(moves);
    expect(clock.pendingCount()).toBe(0);
  });

  it("counts from the last move anyone made, not from the start", () => {
    const { room, clock } = started();
    timeOut(room, clock);
    // A player plays their turn in full.
    const seat = room.gameState!.currentSeat;
    expect(room.submitAction(seat, { type: "draw" }).ok).toBe(true);
    const card = room.gameState!.players[seat]!.hand[0]!;
    expect(room.submitAction(seat, { type: "discard", cardId: card.id }).ok).toBe(true);
    timeOut(room, clock);
    expect(room.paused).toBe(false);
    timeOut(room, clock);
    expect(room.paused).toBe(true);
  });

  it("pauses a competitive table too, which anyone there can resume", () => {
    const { room, clock } = started(COMPETITIVE);
    timeOut(room, clock);
    timeOut(room, clock);
    expect(room.paused).toBe(true);
    // Players still cannot pause a competitive table themselves.
    expect(room.setPaused(1, false)).toEqual({ ok: true, value: undefined });
    expect(room.paused).toBe(false);
    expect(room.setPaused(0, true)).toEqual({
      ok: false,
      error: "pausing is disabled in this mode",
    });
    // Resumed, the clock runs again, and a fresh lap is needed to pause again.
    timeOut(room, clock);
    expect(room.paused).toBe(false);
  });

  it("does not pause a round an auto-played turn just finished, which has no clock to stop", () => {
    const { room } = endRoundOnClockPlayedTurns();
    expect(room.log.entries().at(-1)).toMatchObject({ seat: 1, source: "disconnect" });
    expect(room.paused).toBe(false);
    expect(room.info().idlePaused).toBe(false);
  });

  it("starts a fresh lap when the next round is dealt", () => {
    const { room, clock } = endRoundOnClockPlayedTurns();
    room.setConnected(1, true);
    expect(room.readyForNextRound(0).ok).toBe(true);
    expect(room.readyForNextRound(1)).toEqual({ ok: true, value: true });
    // Everyone just said ready: the turns played for them last round do not count.
    timeOut(room, clock);
    expect(room.paused).toBe(false);
    timeOut(room, clock);
    expect(room.paused).toBe(true);
  });
});

describe("how long a table is kept", () => {
  it("closes a paused table half an hour after it was paused, whoever is still there", () => {
    // Pinned as a literal: the limit the family asked for.
    expect(PAUSED_TABLE_MS).toBe(30 * 60_000);
    const { room, clock } = started();
    expect(room.closing(10_000)).toBeNull();
    clock.advance(5_000);
    room.setPaused(1, true);
    expect(room.closing(10_000)).toEqual({ at: T0 + 5_000 + PAUSED_TABLE_MS, reason: "paused" });
    expect(room.info().closesAt).toBe(T0 + 5_000 + PAUSED_TABLE_MS);
    // Resuming lifts it.
    room.setPaused(0, false);
    expect(room.closing(10_000)).toBeNull();
    expect(room.info().closesAt).toBeNull();
  });

  it("keeps a family table saved for later a week, even with everyone gone", () => {
    // Pinned as a literal, as above.
    expect(SAVED_TABLE_MS).toBe(7 * 24 * 60 * 60_000);
    const { room, clock } = started();
    room.setPaused(0, true);
    clock.advance(60_000);
    expect(room.saveForLater(1)).toEqual({ ok: true, value: undefined });
    room.setConnected(0, false);
    room.setConnected(1, false);
    const until = T0 + 60_000 + SAVED_TABLE_MS;
    expect(room.closing(10_000)).toEqual({ at: until, reason: "saved" });
    expect(room.info()).toMatchObject({ savedUntil: until, closesAt: until });
    // Picking it up again ends the saving: it is an ordinary table once more.
    room.setPaused(0, false);
    expect(room.info().savedUntil).toBeNull();
  });

  it("will only save a started family game", () => {
    const lobby = new Room("LOBBY2", EAST_COAST, {
      clock: new FakeClock(T0),
      seed: 1,
      newToken: () => "t",
    });
    lobby.join("ana");
    expect(lobby.saveForLater(0)).toEqual({ ok: false, error: "the game has not started" });
    const { room } = started();
    expect(room.saveForLater(5)).toEqual({ ok: false, error: "no such seat" });
    const competitive = started(COMPETITIVE).room;
    expect(competitive.saveForLater(0)).toEqual({
      ok: false,
      error: "saving a game for later is for family games",
    });
  });

  it("goes by when everyone left, as before, while it is not paused", () => {
    const { room, clock } = started();
    clock.advance(1_000);
    room.setConnected(0, false);
    room.setConnected(1, false);
    expect(room.closing(10_000)).toEqual({ at: T0 + 1_000 + 10_000, reason: "abandoned" });
  });

  it("does not give a paused table a fresh half hour when it is restored", async () => {
    const store = new InMemoryRoomStore();
    const { room, clock } = started(EAST_COAST, store);
    room.setPaused(0, true);
    clock.advance(20 * 60_000);
    const [stored] = await store.loadOpen();
    const restored = Room.restore(stored!, { clock, newToken: () => "x", store });
    expect(restored.ok && restored.value.closing(10_000)).toEqual({
      at: T0 + PAUSED_TABLE_MS,
      reason: "paused",
    });
  });

  it("restores a table that paused itself, and one saved for later, as they were", async () => {
    const store = new InMemoryRoomStore();
    const { room, clock } = started(EAST_COAST, store);
    timeOut(room, clock);
    timeOut(room, clock);
    room.saveForLater(0);
    const [stored] = await store.loadOpen();
    const restored = Room.restore(stored!, { clock, newToken: () => "x", store });
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.value.info()).toMatchObject({
      idlePaused: true,
      savedUntil: clock.now() + SAVED_TABLE_MS,
    });
    expect(restored.value.paused).toBe(true);
  });
});

describe("a record saved before tables could close themselves", () => {
  it("restores a paused table with its half hour counted from the restore", async () => {
    const store = new InMemoryRoomStore();
    const { room, clock } = started(EAST_COAST, store);
    room.setPaused(0, true);
    const [stored] = await store.loadOpen();
    const older = { ...stored!.room };
    delete older.idlePaused;
    delete older.pausedSince;
    delete older.savedUntil;
    clock.advance(60_000);
    const restored = Room.restore({ ...stored!, room: older }, { clock, newToken: () => "x" });
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.value.info()).toMatchObject({
      pausedBy: 0,
      idlePaused: false,
      savedUntil: null,
    });
    expect(restored.value.closing(10_000)).toEqual({
      at: clock.now() + PAUSED_TABLE_MS,
      reason: "paused",
    });
  });
});

describe("the Node server's sweep", () => {
  it("closes a paused table on time with its players still connected, and says why", () => {
    const clock = new FakeClock(T0);
    const manager = new RoomManager({ clock, abandonedRoomMs: 5_000 });
    const room = manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);
    room.setPaused(0, true);
    const closed: unknown[] = [];
    manager.onRemove = (_room, reason) => closed.push(reason);
    clock.advance(PAUSED_TABLE_MS - 1);
    expect(manager.sweep()).toEqual([]);
    clock.advance(1);
    expect(manager.sweep()).toEqual([room.id]);
    expect(closed).toEqual(["paused"]);
  });
});
