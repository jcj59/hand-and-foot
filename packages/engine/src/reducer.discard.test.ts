import { describe, it, expect } from "vitest";
import { EAST_COAST, type GameState } from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";

function draw(state: GameState): GameState {
  const r = applyAction(state, { type: "draw" });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("discard", () => {
  it("moves a card to the discard top, advances the turn, and resets to draw", () => {
    const s1 = draw(deal(4, EAST_COAST, 42));
    const card = s1.players[0].hand[0];
    const before = s1.players[0].hand.length;
    const r = applyAction(s1, { type: "discard", cardId: card.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.discard.at(-1)).toEqual(card);
    expect(r.state.players[0].hand.length).toBe(before - 1);
    expect(r.state.currentSeat).toBe(1);
    expect(r.state.phase).toBe("draw");
  });

  it("wraps turn order from the last seat back to seat 0", () => {
    const s = draw(deal(2, EAST_COAST, 5));
    const r1 = applyAction(s, { type: "discard", cardId: s.players[0].hand[0].id });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const s2 = draw(r1.state);
    expect(s2.currentSeat).toBe(1);
    const r2 = applyAction(s2, { type: "discard", cardId: s2.players[1].hand[0].id });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.currentSeat).toBe(0);
  });

  it("rejects discarding a card not in hand", () => {
    const s1 = draw(deal(4, EAST_COAST, 9));
    const r = applyAction(s1, { type: "discard", cardId: "no-such-card" });
    expect(r.ok).toBe(false);
  });

  it("rejects a discard during the draw phase", () => {
    const s0 = deal(4, EAST_COAST, 9);
    const r = applyAction(s0, { type: "discard", cardId: s0.players[0].hand[0].id });
    expect(r.ok).toBe(false);
  });

  // Emptying the hand makes the foot pending — but only if there is a foot to pick
  // up. Without that guard the player would be sent to draw an empty foot next turn
  // and be marked `inFoot` holding nothing they ever dealt.
  it("does not make the foot pending when there is no foot to pick up", () => {
    const only = { id: "d-only", rank: "K" as const, suit: "clubs" as const };
    const s: GameState = {
      config: EAST_COAST,
      seed: 0,
      roundNumber: 1,
      players: [
        { hand: [only], foot: [], melds: [], isDown: true, inFoot: false, footPending: false },
        { hand: [], foot: [], melds: [], isDown: false, inFoot: false, footPending: false },
      ],
      currentSeat: 0,
      phase: "play",
      stock: [{ id: "d-stock", rank: "9", suit: "clubs" }],
      discard: [],
    };
    const r = applyAction(s, { type: "discard", cardId: only.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].footPending).toBe(false);
    expect(r.state.players[0].inFoot).toBe(false);
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.currentSeat).toBe(1);
  });

  // The contrast case: an identical discard with a real foot behind it does set the
  // flag, so the assertion above is about the foot being empty and nothing else.
  it("does make the foot pending when a foot is waiting", () => {
    const only = { id: "d-only2", rank: "K" as const, suit: "clubs" as const };
    const s: GameState = {
      config: EAST_COAST,
      seed: 0,
      roundNumber: 1,
      players: [
        {
          hand: [only],
          foot: [{ id: "d-foot", rank: "5", suit: "clubs" }],
          melds: [],
          isDown: true,
          inFoot: false,
          footPending: false,
        },
        { hand: [], foot: [], melds: [], isDown: false, inFoot: false, footPending: false },
      ],
      currentSeat: 0,
      phase: "play",
      stock: [{ id: "d-stock2", rank: "9", suit: "clubs" }],
      discard: [],
    };
    const r = applyAction(s, { type: "discard", cardId: only.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].footPending).toBe(true);
  });
});
