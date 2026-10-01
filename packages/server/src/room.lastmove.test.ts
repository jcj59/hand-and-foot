/**
 * The latest move as each seat is told it: enough to announce a discard or light
 * up a drawn card, and never the drawn card to anyone but the player who drew it.
 */
import { describe, it, expect } from "vitest";
import { EAST_COAST, type Card } from "@hf/shared";
import { canTakePile } from "@hf/engine";
import { FakeClock } from "./clock";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";

function started(seed = 5): Room {
  let n = 0;
  const room = new Room("MOVES2", EAST_COAST, {
    clock: new FakeClock(1_000),
    seed,
    newToken: () => `tok-${n++}`,
  });
  room.join("ana");
  room.join("ben");
  room.join("cy");
  room.start(0);
  return room;
}

describe("the latest move in a view", () => {
  it("is absent before anyone has moved", () => {
    expect(started().viewFor(0)).not.toHaveProperty("lastMove");
  });

  it("shows a drawn card to its drawer only, and that a card was drawn to everyone", () => {
    const room = started();
    const seat = room.gameState!.currentSeat;
    const top = room.gameState!.stock[0]!;
    expect(room.submitAction(seat, { type: "draw" }).ok).toBe(true);
    expect(room.viewFor(seat)!.lastMove).toEqual({ seq: 1, seat, kind: "draw", card: top });
    for (const other of [0, 1, 2].filter((s) => s !== seat)) {
      const move = room.viewFor(other)!.lastMove;
      expect(move).toEqual({ seq: 1, seat, kind: "draw" });
      // Not merely undefined: no key at all, and the card id nowhere in the payload.
      expect(move).not.toHaveProperty("card");
      expect(JSON.stringify(room.viewFor(other))).not.toContain(top.id);
    }
  });

  it("finds the drawn card in the foot, for a player already playing from it", () => {
    const room = started();
    const seat = room.gameState!.currentSeat;
    const state = room.gameState!;
    const internal = room as unknown as { state: object };
    internal.state = {
      ...state,
      players: state.players.map((p, i) => (i === seat ? { ...p, hand: [], inFoot: true } : p)),
    };
    const top = state.stock[0]!;
    room.submitAction(seat, { type: "draw" });
    expect(room.viewFor(seat)!.lastMove).toMatchObject({ kind: "draw", card: top });
  });

  it("tells every seat when a lay-down got its player down by the Marva rule", () => {
    const room = started();
    const seat = room.gameState!.currentSeat;
    room.submitAction(seat, { type: "draw" });
    // The hand down to three fives: melding them empties it, worth 15 against 60.
    const state = room.gameState!;
    const fives: Card[] = [
      { id: "m5a", rank: "5", suit: "clubs" },
      { id: "m5b", rank: "5", suit: "hearts" },
      { id: "m5c", rank: "5", suit: "spades" },
    ];
    const internal = room as unknown as { state: object };
    internal.state = {
      ...state,
      players: state.players.map((p, i) => (i === seat ? { ...p, hand: fives } : p)),
    };
    const melded = room.submitAction(seat, {
      type: "playMelds",
      melds: [{ rank: "5", cardIds: fives.map((c) => c.id) }],
    });
    expect(melded.ok).toBe(true);
    for (const viewer of [0, 1, 2]) {
      expect(room.viewFor(viewer)!.lastMove).toEqual({
        seq: 2,
        seat,
        kind: "meld",
        count: 3,
        marva: true,
      });
    }
    // The next move is news of its own, with no Marva about it.
    const foot = room.gameState!.players[seat]!.foot[0]!;
    room.submitAction(seat, { type: "discard", cardId: foot.id });
    expect(room.viewFor(0)!.lastMove).not.toHaveProperty("marva");
  });

  it("shows everyone the discarded card, and counts up with every move", () => {
    const room = started();
    const seat = room.gameState!.currentSeat;
    room.submitAction(seat, { type: "draw" });
    const card = room.gameState!.players[seat]!.hand[0]!;
    room.submitAction(seat, { type: "discard", cardId: card.id });
    for (const viewer of [0, 1, 2]) {
      expect(room.viewFor(viewer)!.lastMove).toEqual({ seq: 2, seat, kind: "discard", card });
    }
  });

  it("counts the cards taken with the pile, and the cards laid down", () => {
    // A seed where the first player can take the opening pile.
    let room: Room | null = null;
    for (let seed = 1; seed < 500 && !room; seed++) {
      const candidate = started(seed);
      const state = candidate.gameState!;
      const plan = canTakePile(state, state.currentSeat);
      if (plan.feasible && plan.plan && plan.plan.length > 0) room = candidate;
    }
    if (!room) throw new Error("no seed lets the first player take the pile");
    const state = room.gameState!;
    const seat = state.currentSeat;
    const pile = state.discard.length;
    const plan = canTakePile(state, seat).plan!;
    expect(room.submitAction(seat, { type: "takePile" }).ok).toBe(true);
    expect(room.viewFor(seat)!.lastMove).toEqual({ seq: 1, seat, kind: "takePile", count: pile });
    expect(room.submitAction(seat, { type: "playMelds", melds: plan }).ok).toBe(true);
    const laid = plan.reduce((n, m) => n + m.cardIds.length, 0);
    expect(room.viewFor(seat)!.lastMove).toEqual({ seq: 2, seat, kind: "meld", count: laid });
    expect(room.submitAction(seat, { type: "takeBack" }).ok).toBe(true);
    expect(room.viewFor((seat + 1) % 3)!.lastMove).toEqual({ seq: 3, seat, kind: "takeBack" });
  });

  it("reports a move the clock made for a seat as that seat's", () => {
    const room = started();
    const seat = room.gameState!.currentSeat;
    const clock = (room as unknown as { deps: { clock: FakeClock } }).deps.clock;
    clock.advance(EAST_COAST.timers.baseMs + EAST_COAST.timers.discardGraceMs);
    expect(room.viewFor(seat)!.lastMove).toMatchObject({ seat, kind: "discard" });
  });

  it("starts each new round with no latest move", () => {
    const room = started();
    const seat = room.gameState!.currentSeat;
    room.submitAction(seat, { type: "draw" });
    const internal = room as unknown as { state: object };
    internal.state = { ...room.gameState!, roundEnded: true };
    for (const s of [0, 1, 2]) room.readyForNextRound(s);
    expect(room.gameState!.roundNumber).toBe(2);
    expect(room.viewFor(0)).not.toHaveProperty("lastMove");
  });

  it("numbers moves on from where they were after a restart, never repeating one", async () => {
    const store = new InMemoryRoomStore();
    let n = 0;
    const room = new Room("MOVES3", EAST_COAST, {
      clock: new FakeClock(1_000),
      seed: 5,
      newToken: () => `tok-${n++}`,
      store,
    });
    store.saveRoom(room.record());
    room.join("ana");
    room.join("ben");
    room.join("cy");
    room.start(0);
    const seat = room.gameState!.currentSeat;
    room.submitAction(seat, { type: "draw" });
    const card = room.gameState!.players[seat]!.hand[0]!;
    room.submitAction(seat, { type: "discard", cardId: card.id });
    const before = room.viewFor(seat)!.lastMove!.seq;
    expect(before).toBe(2);

    const [stored] = await store.loadOpen();
    const restored = Room.restore(stored!, { clock: new FakeClock(1_000), newToken: () => "x" });
    if (!restored.ok) throw new Error(restored.error);
    const back = restored.value;
    const next = back.gameState!.currentSeat;
    expect(back.submitAction(next, { type: "draw" }).ok).toBe(true);
    expect(back.viewFor(next)!.lastMove!.seq).toBe(3);
  });
});
