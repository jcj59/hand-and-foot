import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type MeldPlay, type RulesConfig } from "@hf/shared";
import { canTakePile, defaultAction, prng } from "@hf/engine";
import { FakeClock } from "./clock";
import { DEFAULT_RECONNECT_GRACE_MS, Room } from "./room";
import { InMemoryRoomStore, type StoredRoom } from "./store";

const FAMILY: RulesConfig = { ...EAST_COAST, mode: "family", pauseEnabled: true };

function openRoom(
  store: InMemoryRoomStore,
  clock = new FakeClock(),
  config: RulesConfig = FAMILY,
  seed = 36,
): Room {
  let token = 0;
  const room = new Room("ABC234", config, {
    clock,
    seed,
    newToken: () => `token-${token++}`,
    store,
    uid: "uid-1",
  });
  // The manager records a room as it opens it; a Room built by hand does it here.
  store.saveRoom(room.record());
  return room;
}

function seat(room: Room, names: readonly string[]): void {
  for (const name of names) expect(room.join(name).ok).toBe(true);
}

/**
 * Play a real stretch of game: take the pile whenever the solver offers a plan
 * and lay that plan down, otherwise draw and discard. So the log carries every
 * action type — melds included — rather than only draws and discards, which is
 * what the restore has to reproduce.
 */
function playRich(room: Room, steps: number, seed = 5): void {
  const rand = prng(seed);
  let plan: readonly MeldPlay[] | null = null;
  for (let i = 0; i < steps; i++) {
    const state = room.gameState;
    if (!state || state.roundEnded) return;
    const actor = state.players[state.currentSeat]!;
    let action: Action;
    if (state.phase === "draw") {
      const take = canTakePile(state, state.currentSeat);
      if (take.feasible && take.plan && take.plan.length > 0) {
        plan = take.plan;
        action = { type: "takePile" };
      } else {
        action = { type: "draw" };
      }
    } else if (plan) {
      action = { type: "playMelds", melds: plan };
      plan = null;
    } else if ((actor.pickedUp ?? []).length > 0) {
      // Picked up where a restart left off: a pile taken, its obligation still
      // owed, and no plan in hand. The policy settles it the way it would for an
      // absent player.
      action = defaultAction(state)!;
    } else {
      // The cards a player can act with: the hand, or the foot once in it.
      const zone = actor.inFoot ? actor.foot : actor.hand;
      if (zone.length === 0) return;
      action = { type: "discard", cardId: zone[Math.floor(rand() * zone.length)]!.id };
    }
    const result = room.submitAction(state.currentSeat, action);
    expect(result.ok, `step ${i}: ${JSON.stringify(result)}`).toBe(true);
  }
}

/** A short game: no extra decks, and the round ends when the stock does. */
const SHORT: RulesConfig = { ...FAMILY, extraDecks: 0, stockExhaustion: "end" };

/** Play the safe default for every seat until the round is over. */
function playToTheEnd(room: Room): void {
  for (let guard = 0; !room.gameState!.roundEnded; guard++) {
    expect(guard).toBeLessThan(2_000);
    const state = room.gameState!;
    expect(room.submitAction(state.currentSeat, defaultAction(state)!).ok).toBe(true);
  }
}

async function onlyRoom(store: InMemoryRoomStore): Promise<StoredRoom> {
  const open = await store.loadOpen();
  expect(open).toHaveLength(1);
  return open[0]!;
}

function restore(stored: StoredRoom, clock: FakeClock, store: InMemoryRoomStore): Room {
  let token = 100;
  const restored = Room.restore(stored, { clock, newToken: () => `token-${token++}`, store });
  if (!restored.ok) throw new Error(restored.error);
  return restored.value;
}

describe("the room's record", () => {
  it("keeps who sits where, whether the table has dealt, and who paused it", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy"]);
    expect((await onlyRoom(store)).room.players.map((p) => p.name)).toEqual(["ana", "ben", "cy"]);

    expect(room.start(0).ok).toBe(true);
    expect((await onlyRoom(store)).room.started).toBe(true);

    expect(room.setPaused(2, true).ok).toBe(true);
    expect((await onlyRoom(store)).room.pausedSeat).toBe(2);
    expect(room.setPaused(0, false).ok).toBe(true);
    expect((await onlyRoom(store)).room.pausedSeat).toBeNull();
  });

  it("follows the seats closing up when someone leaves the lobby", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy"]);
    expect(room.leave("token-0").ok).toBe(true);
    expect((await onlyRoom(store)).room.players).toEqual([
      { seat: 0, name: "ben", token: "token-1", left: false },
      { seat: 1, name: "cy", token: "token-2", left: false },
    ]);
  });

  it("keeps a seat that walked away from a dealt game until its token comes back", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    room.start(0);
    room.leave("token-1");
    expect((await onlyRoom(store)).room.players[1]?.left).toBe(true);
    room.resume("token-1");
    expect((await onlyRoom(store)).room.players[1]?.left).toBe(false);
  });

  it("writes every accepted action through to the store, and no refused one", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy", "dee"]);
    room.start(0);
    const other = (room.gameState!.currentSeat + 1) % 4;
    expect(room.submitAction(other, { type: "draw" }).ok).toBe(false);
    playRich(room, 40);
    const { actions } = await onlyRoom(store);
    expect(actions).toEqual(room.log.entries());
    expect(actions.length).toBe(40);
  });

  it("carries no connection state: a plain reconnect writes nothing", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    const before = JSON.stringify(await store.loadOpen());
    room.setConnected(1, false);
    room.resume("token-1");
    expect(JSON.stringify(await store.loadOpen())).toBe(before);
  });
});

describe("restoring a room after a restart", () => {
  it("rebuilds a game mid-round exactly, melds and taken piles included", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy", "dee"]);
    room.start(0);
    playRich(room, 120);
    const log = room.log.entries();
    expect(log.some((row) => row.action.type === "playMelds")).toBe(true);
    expect(log.some((row) => row.action.type === "takePile")).toBe(true);

    const restored = restore(await onlyRoom(store), new FakeClock(), store);
    expect(restored.gameState).toEqual(room.gameState);
    expect(restored.log.entries()).toEqual(log);
    for (let s = 0; s < 4; s++) {
      // The view is what a returning player actually sees: their own hand, and
      // the table as it stood.
      expect(restored.viewFor(s)?.view).toEqual(room.viewFor(s)?.view);
      expect(restored.viewFor(s)?.hints).toEqual(room.viewFor(s)?.hints);
    }
    expect(restored.id).toBe("ABC234");
    expect(restored.uid).toBe("uid-1");
    expect(restored.record()).toEqual(room.record());
  });

  it("carries on numbering the log where it left off, into the same stored room", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy", "dee"]);
    room.start(0);
    playRich(room, 30);
    const clock = new FakeClock();
    const restored = restore(await onlyRoom(store), clock, store);
    for (const token of ["token-0", "token-1", "token-2", "token-3"]) restored.resume(token);
    playRich(restored, 10, 9);
    const { actions } = await onlyRoom(store);
    expect(actions.map((row) => row.seq)).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it("brings every seat back disconnected, and runs nothing until someone returns", async () => {
    // No socket survives a restart. With every seat gone the room is abandoned,
    // so it must not start playing defaults for a table nobody has come back to.
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy"]);
    room.start(0);
    playRich(room, 10);
    const clock = new FakeClock(1_800_000_000_000);
    const restored = restore(await onlyRoom(store), clock, store);

    expect(restored.seats().every((p) => !p.connected)).toBe(true);
    expect(restored.abandonedSince).toBe(clock.now());
    clock.advance(60 * 60_000);
    expect(restored.log.length).toBe(10);
  });

  it("starts the turn on the clock afresh once a player is back", async () => {
    // How much of the turn was used before the restart died with the process.
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    room.start(0);
    playRich(room, 3);
    const clock = new FakeClock(1_800_000_000_000);
    const restored = restore(await onlyRoom(store), clock, store);
    restored.resume("token-0");
    restored.resume("token-1");
    expect(restored.clockState().deadlineAt).toBe(clock.now() + FAMILY.timers.baseMs);
  });

  it("gives each dropped player their reconnect grace from the restart, not before", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    room.start(0);
    const clock = new FakeClock(1_800_000_000_000);
    const restored = restore(await onlyRoom(store), clock, store);
    const onTurn = restored.gameState!.currentSeat;
    // Only the player *not* on turn comes back; the one on turn is still away.
    restored.resume(`token-${1 - onTurn}`);

    clock.advance(DEFAULT_RECONNECT_GRACE_MS - 1);
    expect(restored.log.length).toBe(0);
    clock.advance(1);
    expect(restored.log.length).toBeGreaterThan(0);
    expect(restored.log.entries().every((row) => row.source === "disconnect")).toBe(true);
  });

  it("keeps a paused table paused", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    room.start(0);
    room.setPaused(1, true);
    const clock = new FakeClock();
    const restored = restore(await onlyRoom(store), clock, store);
    restored.resume("token-0");
    restored.resume("token-1");
    expect(restored.paused).toBe(true);
    expect(restored.info().pausedBy).toBe(1);
    clock.advance(60 * 60_000);
    expect(restored.log.length).toBe(0);
    expect(restored.setPaused(0, false).ok).toBe(true);
    expect(restored.clockState().deadlineAt).toBe(clock.now() + FAMILY.timers.baseMs);
  });

  it("plays a seat that had walked away straight away, as before the restart", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    room.start(0);
    const onTurn = room.gameState!.currentSeat;
    room.leave(`token-${onTurn}`);
    // The leaver's turn is played at once; stop the clock before it runs, so the
    // restart is what has to honour the departure.
    room.dispose();
    const clock = new FakeClock();
    const restored = restore(await onlyRoom(store), clock, store);
    restored.resume(`token-${1 - onTurn}`);
    clock.advance(0);
    expect(restored.log.length).toBeGreaterThan(0);
    expect(restored.log.entries()[0]?.seat).toBe(onTurn);
  });

  it("restores a finished round with its result, and no clock", async () => {
    // Still open until it is reaped, so a player reloading the page sees the scores.
    const store = new InMemoryRoomStore();
    const room = openRoom(store, new FakeClock(), SHORT);
    seat(room, ["ana", "ben"]);
    room.start(0);
    playToTheEnd(room);
    const clock = new FakeClock();
    const restored = restore(await onlyRoom(store), clock, store);
    restored.resume("token-0");
    restored.resume("token-1");
    expect(restored.result()).toEqual(room.result());
    expect(restored.result()).not.toBeNull();
    expect(restored.clockState().deadlineAt).toBeNull();
    expect(clock.pendingCount()).toBe(0);
  });

  it("restores a lobby that can still be joined and dealt from the same seed", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    const restored = restore(await onlyRoom(store), new FakeClock(), store);
    expect(restored.started).toBe(false);
    expect(restored.join("cy").ok).toBe(true);
    expect(restored.start(0).ok).toBe(true);

    seat(room, ["cy"]);
    room.start(0);
    expect(restored.gameState).toEqual(room.gameState);
  });

  it("keeps the time the room was opened, so an unused code is still reaped on schedule", async () => {
    const store = new InMemoryRoomStore();
    const opened = new FakeClock(1_700_000_000_000);
    openRoom(store, opened);
    const restored = restore(await onlyRoom(store), new FakeClock(1_800_000_000_000), store);
    expect(restored.createdAt).toBe(1_700_000_000_000);
    expect(restored.abandonedSince).toBe(1_700_000_000_000);
  });
});

describe("refusing a stored room that does not add up", () => {
  // Rebuilding a different game from the one its players were in would be worse
  // than telling them it is gone.
  async function stored(steps = 12): Promise<StoredRoom> {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy"]);
    room.start(0);
    playRich(room, steps);
    return onlyRoom(store);
  }

  function refusal(entry: StoredRoom): string {
    const result = Room.restore(entry, {
      clock: new FakeClock(),
      newToken: () => "t",
    });
    expect(result.ok).toBe(false);
    return result.ok ? "" : result.error;
  }

  it("a log with a gap in it", async () => {
    const entry = await stored();
    const actions = entry.actions.filter((row) => row.seq !== 4);
    expect(refusal({ ...entry, actions })).toMatch(/gap/);
  });

  it("a log out of order", async () => {
    const entry = await stored();
    const actions = [entry.actions[1]!, entry.actions[0]!, ...entry.actions.slice(2)];
    expect(refusal({ ...entry, actions })).toMatch(/gap or is out of order/);
  });

  it("an action recorded against the wrong seat", async () => {
    const entry = await stored();
    const actions = entry.actions.map((row, i) =>
      i === 3 ? { ...row, seat: (row.seat + 1) % 3 } : row,
    );
    expect(refusal({ ...entry, actions })).toMatch(/action 3 is out of turn/);
  });

  it("an action the engine will not accept", async () => {
    // What a change to the rules between deploys would look like.
    const entry = await stored();
    const actions = entry.actions.map((row, i) =>
      i === 5 ? { ...row, action: { type: "discard" as const, cardId: "no-such-card" } } : row,
    );
    expect(refusal({ ...entry, actions })).toMatch(/action 5 replays as refused/);
  });

  it("actions for a table that never dealt", async () => {
    const entry = await stored();
    expect(refusal({ ...entry, room: { ...entry.room, started: false } })).toMatch(/never dealt/);
  });

  it("seats that are not numbered from zero", async () => {
    const entry = await stored();
    const players = entry.room.players.map((p, i) => (i === 1 ? { ...p, seat: 5 } : p));
    expect(refusal({ ...entry, room: { ...entry.room, players } })).toMatch(/seats/);
  });

  it("a pause held by a seat that does not exist", async () => {
    const entry = await stored();
    expect(refusal({ ...entry, room: { ...entry.room, pausedSeat: 7 } })).toMatch(/paused by/);
  });

  it("a log that runs on past the end of the round", async () => {
    // The engine refuses every move once the round is over, so a row claiming one
    // is refused by the replay itself.
    const store = new InMemoryRoomStore();
    const room = openRoom(store, new FakeClock(), SHORT);
    seat(room, ["ana", "ben"]);
    room.start(0);
    playToTheEnd(room);
    const entry = await onlyRoom(store);
    const extra = {
      ...entry.actions[0]!,
      seq: entry.actions.length,
      seat: room.gameState!.currentSeat,
      action: { type: "draw" as const },
    };
    expect(refusal({ ...entry, actions: [...entry.actions, extra] })).toMatch(
      new RegExp(`action ${entry.actions.length} replays as refused`),
    );
  });
});

describe("restoring who hosts", () => {
  it("keeps a handed-on host across a restart", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben", "cy"]);
    room.setHost(0, 2);
    const restored = restore(await onlyRoom(store), new FakeClock(), store);
    expect(restored.hostSeat).toBe(2);
  });

  it("falls back to the first seat for a room saved before hosting could move", async () => {
    const store = new InMemoryRoomStore();
    const room = openRoom(store);
    seat(room, ["ana", "ben"]);
    const entry = await onlyRoom(store);
    const older = { ...entry.room };
    delete older.hostToken;
    // Nor was anything waited on between rounds or after the match recorded.
    delete older.nextRoundReady;
    delete older.wentOn;
    delete older.nextRoomId;
    const restored = restore({ ...entry, room: older }, new FakeClock(), store);
    expect(restored.hostSeat).toBe(0);
    expect(restored.info().nextRoundReady).toEqual([]);
    expect(restored.info().playAgain).toEqual([]);
    expect(restored.nextRoomId).toBeNull();
    expect(restored.join("cy").ok).toBe(true);
    expect(restored.hostSeat).toBe(0);
  });
});
