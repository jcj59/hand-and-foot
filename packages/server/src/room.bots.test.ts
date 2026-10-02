/**
 * Computer players: added by the host in the lobby, playing the heuristic at a
 * person's pace through the same path as everyone else, and playing for people
 * who have gone.
 */
import { describe, it, expect } from "vitest";
import { defaultAvatar, EAST_COAST, type RulesConfig } from "@hf/shared";
import { defaultAction, heuristicPolicy } from "@hf/engine";
import { FakeClock } from "./clock";
import { BOT_MOVE_MS, BOT_NAMES, DEFAULT_RECONNECT_GRACE_MS, Room } from "./room";
import { InMemoryRoomStore } from "./store";

/** Short rounds: no extra decks, and a round ends when the stock does. */
const SHORT: RulesConfig = { ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" };
const T0 = 1_700_000_000_000;

function lobby(store?: InMemoryRoomStore): { room: Room; clock: FakeClock } {
  const clock = new FakeClock(T0);
  let token = 0;
  const room = new Room("BOTS23", SHORT, {
    clock,
    seed: 21,
    newToken: () => `t${token++}`,
    store,
    pauseWhenIdle: false,
  });
  store?.saveRoom(room.record());
  expect(room.join("ana").ok).toBe(true);
  return { room, clock };
}

/** Ana and two computer players, dealt. */
function withBots(store?: InMemoryRoomStore): { room: Room; clock: FakeClock } {
  const made = lobby(store);
  expect(made.room.addBot(0).ok).toBe(true);
  expect(made.room.addBot(0).ok).toBe(true);
  expect(made.room.start(0).ok).toBe(true);
  return made;
}

/** Play Ana's turns by default and let the clock play the computers', until the round ends. */
function playRound(room: Room, clock: FakeClock): void {
  for (let guard = 0; !room.gameState!.roundEnded; guard++) {
    expect(guard).toBeLessThan(5_000);
    const state = room.gameState!;
    if (state.currentSeat === 0) room.submitAction(0, defaultAction(state)!);
    else clock.advance(BOT_MOVE_MS);
  }
}

describe("adding computer players in the lobby", () => {
  it("seats one named and pictured, marked as a computer player for everyone", () => {
    const { room } = lobby();
    const added = room.addBot(0);
    expect(added.ok && added.value).toMatchObject({
      seat: 1,
      name: "Robo Rita",
      avatar: defaultAvatar("Robo Rita"),
      bot: true,
      connected: true,
    });
    expect(room.addBot(0).ok && room.seats()[2]!.name).toBe("Robo Ray");
    expect(room.info().players.map((p) => p.bot ?? false)).toEqual([false, true, true]);
    // Its token, like anyone's, never reaches the table.
    expect(JSON.stringify(room.info())).not.toContain(room.seats()[1]!.token);
  });

  it("is the host's alone, before the deal, while a seat is free", () => {
    const { room } = lobby();
    room.join("ben");
    expect(room.addBot(1)).toEqual({ ok: false, error: "only the host can add a computer player" });
    for (let i = 0; i < 6; i++) expect(room.addBot(0).ok).toBe(true);
    expect(room.addBot(0)).toEqual({ ok: false, error: "a table seats at most 8" });
    const dealt = withBots().room;
    expect(dealt.addBot(0)).toEqual({
      ok: false,
      error: "computer players can only be added before the deal",
    });
  });

  it("hands out names not already at the table", () => {
    const { room } = lobby();
    room.addBot(0);
    room.addBot(0);
    expect(room.removeBot(0, 1).ok).toBe(true);
    room.addBot(0);
    expect(room.seats().map((p) => p.name)).toEqual(["ana", "Robo Ray", "Robo Rita"]);
    expect(BOT_NAMES).toHaveLength(7);
  });

  it("can be taken away again by the host, closing up the seats behind it", () => {
    const { room } = lobby();
    room.addBot(0);
    room.join("ben");
    expect(room.removeBot(1, 1)).toEqual({
      ok: false,
      error: "only the host can take a computer player away",
    });
    expect(room.removeBot(0, 2)).toEqual({
      ok: false,
      error: "there is no computer player in that seat",
    });
    expect(room.removeBot(0, 1).ok).toBe(true);
    expect(room.seats().map((p) => [p.seat, p.name])).toEqual([
      [0, "ana"],
      [1, "ben"],
    ]);
    const dealt = withBots().room;
    expect(dealt.removeBot(0, 1)).toEqual({
      ok: false,
      error: "computer players can only be taken away before the deal",
    });
  });

  it("never hosts: not handed it, and not passed it when the host leaves", () => {
    const { room } = lobby();
    room.addBot(0);
    room.join("ben");
    expect(room.setHost(0, 1)).toEqual({ ok: false, error: "a computer player cannot host" });
    room.leave("t0");
    expect(room.seats()[room.hostSeat]!.name).toBe("ben");
  });

  it("leaves a lobby of computer players alone to be closed as never used", () => {
    const { room } = lobby();
    room.addBot(0);
    room.leave("t0");
    expect(room.abandonedSince).toBe(T0);
  });
});

describe("a computer player's turn", () => {
  it("plays one move at a time, a person's pace apart, logged as the computer's", () => {
    const { room, clock } = withBots();
    // Seed 21 deals the first turn to Ana.
    expect(room.gameState!.currentSeat).toBe(0);
    room.submitAction(0, { type: "draw" });
    const card = room.gameState!.players[0]!.hand[0]!;
    room.submitAction(0, { type: "discard", cardId: card.id });
    const logged = room.log.length;
    clock.advance(BOT_MOVE_MS - 1);
    expect(room.log.length).toBe(logged);
    clock.advance(1);
    expect(room.log.length).toBe(logged + 1);
    expect(room.log.entries().at(-1)).toMatchObject({ seat: 1, source: "bot" });
    clock.advance(BOT_MOVE_MS);
    expect(room.log.length).toBe(logged + 2);
  });

  it("plays what the heuristic would, from its own view", () => {
    const { room, clock } = withBots();
    const state = room.gameState!;
    room.submitAction(0, defaultAction(state)!);
    room.submitAction(0, defaultAction(room.gameState!)!);
    const before = room.gameState!;
    expect(before.currentSeat).toBe(1);
    clock.advance(BOT_MOVE_MS);
    expect(room.log.entries().at(-1)!.action).toEqual(heuristicPolicy(before, 1));
  });

  it("plays whole rounds that end, getting down along the way", () => {
    const { room, clock } = withBots();
    playRound(room, clock);
    const ended = room.gameState!;
    expect(ended.roundEnded).toBe(true);
    expect(
      room.log.entries().some((e) => e.source === "bot" && e.action.type === "playMelds"),
    ).toBe(true);
  });

  it("is always ready for the next round", () => {
    const { room, clock } = withBots();
    playRound(room, clock);
    expect(room.readyForNextRound(0)).toEqual({ ok: true, value: true });
    expect(room.gameState!.roundNumber).toBe(2);
  });

  it("stops while the table is paused, and goes on when it resumes", () => {
    const { room, clock } = withBots();
    room.submitAction(0, defaultAction(room.gameState!)!);
    room.submitAction(0, defaultAction(room.gameState!)!);
    expect(room.setPaused(0, true).ok).toBe(true);
    const logged = room.log.length;
    clock.advance(BOT_MOVE_MS * 10);
    expect(room.log.length).toBe(logged);
    room.setPaused(0, false);
    clock.advance(BOT_MOVE_MS);
    expect(room.log.length).toBe(logged + 1);
  });

  it("stops when every person has gone, leaving the table to be closed", () => {
    const { room, clock } = withBots();
    room.submitAction(0, defaultAction(room.gameState!)!);
    room.submitAction(0, defaultAction(room.gameState!)!);
    room.setConnected(0, false);
    expect(room.abandoned).toBe(true);
    const logged = room.log.length;
    clock.advance(BOT_MOVE_MS * 10);
    expect(room.log.length).toBe(logged);
    expect(clock.pendingCount()).toBe(0);
    expect(room.abandonedSince).toBe(T0);
  });

  it("can be let go by the host between rounds, though it never leaves the table", () => {
    const { room, clock } = withBots();
    playRound(room, clock);
    expect(room.removePlayer(0, 2).ok).toBe(true);
    expect(room.gameState!.departed).toEqual([{ seat: 2, afterRound: 1 }]);
  });

  it("counts towards a lap nobody played, so a table of computers and nobody watching pauses", () => {
    const clock = new FakeClock(T0);
    let token = 0;
    const room = new Room("IDLE89", SHORT, { clock, seed: 21, newToken: () => `t${token++}` });
    room.join("ana");
    room.addBot(0);
    room.start(0);
    // Ana is there but does not play: her turn runs out, then the computer plays its own.
    const { baseMs, discardGraceMs } = SHORT.timers;
    for (let guard = 0; !room.paused; guard++) {
      expect(guard).toBeLessThan(20);
      clock.advance(room.gameState!.currentSeat === 0 ? baseMs + discardGraceMs : BOT_MOVE_MS);
    }
    expect(room.info().idlePaused).toBe(true);
    // One lap: Ana's turn played out by the clock, then the computer's own. Had the
    // computer's turn not counted, Ana would have been timed out a second time first.
    const timedOut = room.log.entries().filter((e) => e.source === "timeout");
    expect(new Set(timedOut.map((e) => e.seat))).toEqual(new Set([0]));
    expect(room.log.entries().at(-1)!.source).toBe("bot");
    expect(room.gameState!.currentSeat).toBe(0);
    expect(timedOut.filter((e) => e.action.type === "discard")).toHaveLength(1);
  });
});

describe("a person who has gone", () => {
  it("is played for by the heuristic rather than the safe default", () => {
    const clock = new FakeClock(T0);
    let token = 0;
    const room = new Room("GONE23", SHORT, {
      clock,
      seed: 21,
      newToken: () => `t${token++}`,
      pauseWhenIdle: false,
    });
    room.join("ana");
    room.join("ben");
    room.start(0);
    room.setConnected(1, false);
    clock.advance(DEFAULT_RECONNECT_GRACE_MS);
    // Ana plays; each of Ben's turns is played for him the moment it comes round.
    let differs = false;
    for (let turn = 0; turn < 10 && !room.gameState!.roundEnded; turn++) {
      while (room.gameState!.currentSeat === 0 && !room.gameState!.roundEnded) {
        room.submitAction(0, defaultAction(room.gameState!)!);
      }
      if (room.gameState!.roundEnded) break;
      const before = room.gameState!;
      const expected = heuristicPolicy(before, 1);
      differs ||= JSON.stringify(expected) !== JSON.stringify(defaultAction(before));
      const logged = room.log.length;
      clock.advance(0);
      expect(room.log.entries()[logged]).toMatchObject({
        seat: 1,
        source: "disconnect",
        action: expected,
      });
    }
    // Somewhere in those turns the heuristic chose what the default would not.
    expect(differs).toBe(true);
  });
});

describe("computer players across a restart", () => {
  it("come back at the table and play on once a person is back", async () => {
    const store = new InMemoryRoomStore();
    const { room } = withBots(store);
    room.submitAction(0, defaultAction(room.gameState!)!);
    room.submitAction(0, defaultAction(room.gameState!)!);
    const [stored] = await store.loadOpen();
    expect(stored!.room.players.map((p) => p.bot ?? false)).toEqual([false, true, true]);
    const clock = new FakeClock(T0 + 1_000);
    const restored = Room.restore(stored!, { clock, newToken: () => "x", pauseWhenIdle: false });
    if (!restored.ok) throw new Error(restored.error);
    const back = restored.value;
    expect(back.gameState).toEqual(room.gameState);
    expect(back.seats().map((p) => p.connected)).toEqual([false, true, true]);
    // Nobody is back yet: the computers wait.
    const logged = back.log.length;
    clock.advance(BOT_MOVE_MS * 5);
    expect(back.log.length).toBe(logged);
    expect(back.resume("t0").ok).toBe(true);
    clock.advance(BOT_MOVE_MS);
    expect(back.log.length).toBe(logged + 1);
  });
});

describe("the pace of a computer player", () => {
  it("is a move every 1.2 seconds", () => {
    expect(BOT_MOVE_MS).toBe(1_200);
  });
});
