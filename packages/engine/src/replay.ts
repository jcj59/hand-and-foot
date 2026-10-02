import type { Action, GameState, RulesConfig } from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";

/**
 * Reconstruct the state of a game from its seed, the seat that started it, and the
 * sequence of actions that were applied, by folding the reducer over a fresh deal. Throws if a recorded
 * action is rejected, which would mean the engine diverged from the recorded
 * game. This underpins golden-game regression tests and end-to-end determinism:
 * because the engine is deterministic, a seed plus an action list reproduces the
 * exact same game every time.
 */
export function replay(
  seed: number,
  playerCount: number,
  config: RulesConfig,
  actions: readonly Action[],
  firstSeat = 0,
): GameState {
  let state = deal(playerCount, config, seed, 1, firstSeat);
  for (const action of actions) {
    const r = applyAction(state, action);
    if (!r.ok) {
      throw new Error(`replay rejected a recorded ${action.type} action: ${r.error}`);
    }
    state = r.state;
  }
  return state;
}
