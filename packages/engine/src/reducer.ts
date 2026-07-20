import type { Action, GameState } from "@hf/shared";
import { type ApplyResult, fail } from "./core";
import { applyDraw } from "./draw";
import { applyDiscard } from "./discard";
import { applyPlayMelds } from "./playMelds";

export type { ApplyResult };

/**
 * The pure turn engine. Validates an action against the current phase and state
 * and returns either the next state or a rejection. It never mutates its input,
 * which is what makes replay, property testing, and agent search over cloned
 * states possible. Not-yet-implemented actions are rejected until later diffs
 * add their handlers.
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  switch (action.type) {
    case "draw":
      return applyDraw(state);
    case "discard":
      return applyDiscard(state, action.cardId);
    case "playMelds":
      return applyPlayMelds(state, action.melds);
    case "takePile":
      return fail(`the "takePile" action is not yet implemented`);
  }
}
