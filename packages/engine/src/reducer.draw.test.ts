import { describe, it, expect } from "vitest";
import { EAST_COAST } from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";

describe("draw", () => {
  it("moves the top stock card to the current player's hand and advances to play", () => {
    const s0 = deal(4, EAST_COAST, 123);
    const top = s0.stock[0];
    const r = applyAction(s0, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].hand.length).toBe(s0.players[0].hand.length + 1);
    expect(r.state.stock.length).toBe(s0.stock.length - 1);
    expect(r.state.players[0].hand.at(-1)).toEqual(top);
    expect(r.state.phase).toBe("play");
    expect(r.state.currentSeat).toBe(0);
  });

  it("is deterministic in the seed", () => {
    const a = applyAction(deal(4, EAST_COAST, 7), { type: "draw" });
    const b = applyAction(deal(4, EAST_COAST, 7), { type: "draw" });
    expect(a).toEqual(b);
  });

  it("rejects a draw outside the draw phase", () => {
    const s0 = deal(4, EAST_COAST, 1);
    const first = applyAction(s0, { type: "draw" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyAction(first.state, { type: "draw" });
    expect(second.ok).toBe(false);
  });
});
