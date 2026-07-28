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
});
