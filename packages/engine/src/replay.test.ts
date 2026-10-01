import { describe, it, expect } from "vitest";
import { EAST_COAST } from "@hf/shared";
import { replay } from "./replay";
import { record, recordRich } from "./testing/golden";

describe("replay", () => {
  it("replays a recorded transcript to the exact same final state", () => {
    const { actions, finalState } = record(1234, 4, 120);
    expect(actions.length).toBeGreaterThan(0);
    expect(replay(1234, 4, EAST_COAST, actions)).toEqual(finalState);
  });

  it("is deterministic: the same seed and actions reproduce an identical state", () => {
    const { actions } = record(555, 3, 90);
    const a = replay(555, 3, EAST_COAST, actions);
    const b = replay(555, 3, EAST_COAST, actions);
    expect(a).toEqual(b);
  });

  it("throws if a recorded action is illegal for the reconstructed game", () => {
    expect(() => replay(1, 4, EAST_COAST, [{ type: "discard", cardId: "nope" }])).toThrow();
  });
});

describe("replay of transcripts containing every action type", () => {
  it("reproduces the exact final state of a game that takes the pile and melds", () => {
    // Seeds chosen because an opening take is available, so the transcript is
    // guaranteed to contain takePile and playMelds rather than draws alone.
    for (const seed of [36, 58, 72, 89, 113]) {
      const { actions, finalState, tookPile } = recordRich(seed, 4, 150);
      expect(tookPile, `seed ${seed} never took the pile`).toBeGreaterThan(0);
      expect(actions.some((a) => a.type === "playMelds")).toBe(true);
      expect(replay(seed, 4, EAST_COAST, actions)).toEqual(finalState);
    }
  });

  it("is deterministic for a rich transcript", () => {
    const { actions } = recordRich(36, 4, 150);
    expect(replay(36, 4, EAST_COAST, actions)).toEqual(replay(36, 4, EAST_COAST, actions));
  });

  it("throws when a recorded takePile is no longer legal", () => {
    // Taking the pile twice in a row cannot happen in a real game, so replaying it
    // must fail loudly rather than silently diverge.
    expect(() => replay(36, 4, EAST_COAST, [{ type: "takePile" }, { type: "takePile" }])).toThrow();
  });
});
