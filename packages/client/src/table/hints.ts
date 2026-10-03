/**
 * In-game hints: what the table says to help a player who is learning, when they
 * ask for it.
 *
 * Two kinds. Reasons, for a move that is not open — chiefly why the pile cannot be
 * taken, which the server works out for this seat alone (`LegalHints.takePileWhy`),
 * since it needs the solver the reducer uses. And a suggested move: the heuristic
 * computer player's choice, asked of it in the browser from this player's own view
 * and nothing else, so a suggestion can never be better informed than the player.
 *
 * Hints are a per-device choice, on by default at a family table and off at a
 * competitive one, where being told a good move is not the game being played.
 */
import {
  type Action,
  type Card,
  type GameMode,
  type PlayerView,
  type Rank,
  type RulesConfig,
} from "@hf/shared";
import { heuristicAction } from "@hf/engine";
import { rankLabel, suitSymbol } from "../cards/cardText";

export const HINTS_KEY = "hf.hints";

/** Whether hints are on at a table of this mode: the device's choice, or the mode's default. */
export function readHints(mode: GameMode): boolean {
  try {
    const stored = window.localStorage.getItem(HINTS_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Blocked storage: fall back to the default.
  }
  return mode === "family";
}

export function writeHints(on: boolean): void {
  try {
    window.localStorage.setItem(HINTS_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

/** A suggested move: what to do, in words, and the cards it would play. */
export interface Suggestion {
  readonly text: string;
  readonly cardIds: ReadonlySet<string>;
}

/** A card as it reads on its corner: "K♠", "10♦", "Joker". */
export function shortCard(card: Card): string {
  return card.rank === "JOKER" ? "Joker" : `${rankLabel(card.rank)}${suitSymbol(card.suit)}`;
}

function plural(rank: Rank): string {
  return rank === "JOKER" ? "jokers" : `${rankLabel(rank)}s`;
}

/**
 * What the computer player would do from this seat's view, in words, or null when
 * it is not this seat's turn. Only the view: the move cannot use a card the player
 * cannot see.
 */
export function suggestionFor(view: PlayerView, config: RulesConfig): Suggestion | null {
  const action = heuristicAction(view, config);
  return action && describe(action, view);
}

function describe(action: Action, view: PlayerView): Suggestion | null {
  const zone = view.inFoot ? (view.foot ?? []) : view.hand;
  const byId = new Map(zone.map((card) => [card.id, card]));
  const none = new Set<string>();
  switch (action.type) {
    case "draw":
      return { text: "Draw from the stock.", cardIds: none };
    case "takePile":
      return { text: "Take the pile.", cardIds: none };
    case "discard": {
      const card = byId.get(action.cardId);
      /* v8 ignore next -- the heuristic only discards a card from the zone it plays */
      if (!card) return null;
      return { text: `Discard the ${shortCard(card)}.`, cardIds: new Set([card.id]) };
    }
    case "playMelds": {
      const parts = action.melds.map((meld) => {
        const cards = meld.cardIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
        const onto = view.melds.some((m) => m.rank === meld.rank) ? " onto your " : " as ";
        return `${cards.map(shortCard).join(" ")}${onto}${plural(meld.rank)}`;
      });
      const ids = new Set(action.melds.flatMap((meld) => meld.cardIds));
      return { text: `Meld ${parts.join("; ")}.`, cardIds: ids };
    }
    /* v8 ignore next 4 -- the heuristic never takes back, and the table's moves are not a seat's */
    case "takeBack":
    case "nextRound":
    case "removePlayer":
      return null;
  }
}
