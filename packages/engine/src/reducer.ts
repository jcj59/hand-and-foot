import type { Action, GameState } from "@hf/shared";
import { type ApplyResult, fail } from "./core";
import { applyDraw } from "./draw";
import { applyDiscard } from "./discard";
import { applyPlayMelds } from "./playMelds";
import { applyNextRound } from "./nextRound";
import { applyTakePile } from "./takePile";
import { applyTakeBack } from "./takeBack";

export type { ApplyResult };

/**
 * The pure turn engine. Validates an action against the current phase and state
 * and returns either the next state or a rejection. It never mutates its input,
 * which is what makes replay, property testing, and agent search over cloned
 * states possible. Once a round has ended, the only action accepted is dealing
 * the next one.
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  if (action.type === "nextRound") return applyNextRound(state);
  if (state.roundEnded) {
    return fail("the round has already ended");
  }
  switch (action.type) {
    case "draw":
      return applyDraw(state);
    case "takePile":
      return applyTakePile(state);
    case "playMelds":
      return applyPlayMelds(state, action.melds);
    case "discard":
      return applyDiscard(state, action.cardId);
    case "takeBack":
      return applyTakeBack(state);
  }
}
