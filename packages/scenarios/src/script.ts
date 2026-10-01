/**
 * Scenario scripts: a game written as intentions — "draw", "meld these kings",
 * "discard the nine of clubs", "play on until the round ends" — and resolved into
 * concrete engine actions by playing them, so a script never carries a card id.
 *
 * A card named in a step is looked for in the active zone of the player on turn
 * at that moment, which is also where the cards of a pile just taken are; so a
 * script reads like a description of the turn rather than a list of ids.
 */
import type { Action, Card, GameState, MeldPlay, PlayerState, Rank } from "@hf/shared";
import { applyAction, chooseDiscard, isMatchOver } from "@hf/engine";
import { parseCards, takeCards } from "./cards";
import { autopilotAction } from "./autopilot";

/** The cards the player is playing from: the hand, or the foot once picked up. */
function activeCards(player: PlayerState): readonly Card[] {
  return player.inFoot ? player.foot : player.hand;
}

export type ScriptStep =
  | { readonly do: "draw" }
  | { readonly do: "takePile" }
  | { readonly do: "takeBack" }
  | { readonly do: "nextRound" }
  /** A named card, or whatever the default discard heuristic would throw. */
  | { readonly do: "discard"; readonly card?: string }
  | { readonly do: "meld"; readonly melds: Readonly<Partial<Record<Rank, string>>> }
  | { readonly do: "moment"; readonly id: string; readonly label: string }
  /**
   * Let the autopilot play: a number of whole turns, or until the round or the
   * whole match is over (dealing each next round, for the match).
   */
  | { readonly do: "auto"; readonly until: "round" | "match" }
  | { readonly do: "auto"; readonly turns: number };

export const draw = (): ScriptStep => ({ do: "draw" });
export const takePile = (): ScriptStep => ({ do: "takePile" });
export const takeBack = (): ScriptStep => ({ do: "takeBack" });
export const nextRound = (): ScriptStep => ({ do: "nextRound" });
export const discard = (card?: string): ScriptStep => ({
  do: "discard",
  ...(card ? { card } : {}),
});
export const meld = (melds: Readonly<Partial<Record<Rank, string>>>): ScriptStep => ({
  do: "meld",
  melds,
});
export const moment = (id: string, label: string): ScriptStep => ({ do: "moment", id, label });
export const autoTurns = (turns: number): ScriptStep => ({ do: "auto", turns });
export const autoUntil = (until: "round" | "match"): ScriptStep => ({ do: "auto", until });

/** Far more than any real round takes; reaching it means the autopilot is stuck. */
export const AUTO_ACTION_LIMIT = 5_000;

export interface Resolved {
  readonly actions: Action[];
  readonly moments: { id: string; label: string; step: number }[];
  /** The position the script ends on. */
  readonly final: GameState;
}

/** Turn a script into actions by playing it from `start`. Throws on any step that cannot be played. */
export function resolveScript(start: GameState, script: readonly ScriptStep[]): Resolved {
  let state = start;
  const actions: Action[] = [];
  const moments: Resolved["moments"] = [];

  const apply = (action: Action, what: string): void => {
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(`step ${actions.length + 1} (${what}) was refused: ${r.error}`);
    state = r.state;
    actions.push(action);
    if (actions.length > AUTO_ACTION_LIMIT)
      throw new Error(`more than ${AUTO_ACTION_LIMIT} actions`);
  };
  const autoplay = (): void => {
    const action = autopilotAction(state);
    /* v8 ignore next -- callers stop at the end of the round */
    if (!action) throw new Error("the autopilot has nothing to play");
    apply(action, `autopilot ${action.type}`);
  };

  for (const step of script) {
    switch (step.do) {
      case "moment":
        moments.push({ id: step.id, label: step.label, step: actions.length });
        break;
      case "discard": {
        const zone = activeCards(state.players[state.currentSeat]!);
        const card = step.card
          ? takeCards(zone, parseCards(step.card), `in seat ${state.currentSeat}'s cards`).taken[0]!
          : chooseDiscard(state, state.currentSeat);
        if (!card) throw new Error(`seat ${state.currentSeat} has nothing to discard`);
        apply({ type: "discard", cardId: card.id }, `discard ${step.card ?? "by heuristic"}`);
        break;
      }
      case "meld": {
        let zone = [...activeCards(state.players[state.currentSeat]!)];
        const plays: MeldPlay[] = Object.entries(step.melds).map(([rank, text]) => {
          const { taken, rest } = takeCards(
            zone,
            parseCards(text!),
            `in seat ${state.currentSeat}'s cards`,
          );
          zone = rest;
          return { rank: rank as Rank, cardIds: taken.map((c) => c.id) };
        });
        apply({ type: "playMelds", melds: plays }, "meld");
        break;
      }
      case "auto":
        if ("turns" in step) {
          for (let turn = 0; turn < step.turns && !state.roundEnded; turn++) {
            const seat = state.currentSeat;
            do autoplay();
            while (state.currentSeat === seat && !state.roundEnded);
          }
        } else {
          for (;;) {
            while (!state.roundEnded) autoplay();
            if (step.until === "round" || isMatchOver(state)) break;
            apply({ type: "nextRound" }, "nextRound");
          }
        }
        break;
      default:
        apply({ type: step.do }, step.do);
    }
  }
  return { actions, moments, final: state };
}
