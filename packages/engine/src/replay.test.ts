import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type Card, type GameState } from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";
import { prng } from "./rng";
import { replay } from "./replay";

function activeZone(state: GameState): readonly Card[] {
  const p = state.players[state.currentSeat];
  return p.inFoot ? p.foot : p.hand;
}

/** Play a deterministic draw/discard game and record its action transcript. */
function record(
  seed: number,
  players: number,
  steps: number,
): { actions: Action[]; finalState: GameState } {
  let state = deal(players, EAST_COAST, seed);
  const rand = prng(seed);
  const actions: Action[] = [];
  for (let i = 0; i < steps && !state.roundEnded; i++) {
    const zone = activeZone(state);
    const action: Action =
      state.phase === "draw"
        ? { type: "draw" }
        : { type: "discard", cardId: zone[Math.floor(rand() * zone.length)].id };
    const r = applyAction(state, action);
    if (!r.ok) break;
    actions.push(action);
    state = r.state;
  }
  return { actions, finalState: state };
}

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
