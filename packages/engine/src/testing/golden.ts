/**
 * Golden games: deterministic transcripts recorded by playing the engine itself,
 * for tests that need a real game rather than a hand-made position.
 *
 * Not part of the engine — nothing in the game imports it — but exported as
 * `@hf/engine/testing` so other packages' tests can use the same games the
 * engine's replay tests pin, rather than recording their own.
 */
import { EAST_COAST, type Action, type Card, type GameState, type MeldPlay } from "@hf/shared";
import { deal } from "../deal";
import { canTakePile } from "../feasibility";
import { applyAction } from "../reducer";
import { prng } from "../rng";

function activeZone(state: GameState): readonly Card[] {
  const p = state.players[state.currentSeat];
  return p.inFoot ? p.foot : p.hand;
}

/** Play a deterministic draw/discard game and record its action transcript. */
export function record(
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

/**
 * Record a game that uses all four action types, so a transcript exercises taking
 * the pile and laying melds rather than only drawing and discarding. The pile is
 * taken whenever the solver offers a plan, and that plan settles the obligation.
 */
export function recordRich(
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
