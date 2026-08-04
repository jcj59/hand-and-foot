import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type Card, type GameState, type MeldPlay } from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";
import { prng } from "./rng";
import { replay } from "./replay";
import { canTakePile } from "./feasibility";

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

/**
 * Record a game that uses all four action types, so a transcript exercises taking
 * the pile and laying melds rather than only drawing and discarding. The pile is
 * taken whenever the solver offers a plan, and that plan settles the obligation.
 */
function recordRich(
  seed: number,
  players: number,
  steps: number,
): { actions: Action[]; finalState: GameState; tookPile: number } {
  let state = deal(players, EAST_COAST, seed);
  const rand = prng(seed + 31);
  const actions: Action[] = [];
  let plan: readonly MeldPlay[] | null = null;
  let tookPile = 0;

  for (let i = 0; i < steps && !state.roundEnded; i++) {
    let action: Action;
    if (state.phase === "draw") {
      const f = canTakePile(state, state.currentSeat);
      if (f.feasible && f.plan && f.plan.length > 0) {
        plan = f.plan;
        action = { type: "takePile" };
      } else {
        action = { type: "draw" };
      }
    } else if (plan) {
      action = { type: "playMelds", melds: plan };
      plan = null;
    } else {
      const zone = activeZone(state);
      if (zone.length === 0) break;
      action = { type: "discard", cardId: zone[Math.floor(rand() * zone.length)].id };
    }
    const r = applyAction(state, action);
    if (!r.ok) break;
    if (action.type === "takePile") tookPile++;
    actions.push(action);
    state = r.state;
  }
  return { actions, finalState: state, tookPile };
}

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
