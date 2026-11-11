/**
 * The latest move, in one line under the piles, and the few before it in the
 * computer's side panel: "Kate took the pile (7 cards)", "You drew a card".
 *
 * Every kind of move gets a line, unlike the announcement (`moveNews`), which
 * only interrupts for the moves that change what others can do. A card drawn
 * from the stock is never named: only its owner sees it.
 */
import type { Card, LastMove } from "@hf/shared";
import { suitSymbol } from "../cards/cardText";

/** A card as the line writes it: "the 5♣", "a Joker". */
export function cardShort(card: Card): string {
  if (card.rank === "JOKER") return "a Joker";
  return `the ${card.rank}${suitSymbol(card.suit)}`;
}

/** One line for a move; `you` when the move was the viewer's own. */
export function moveLine(move: LastMove, name: string, you: boolean): string {
  const who = you ? "You" : name;
  const count = move.count ?? 0;
  const cards = `${count} card${count === 1 ? "" : "s"}`;
  switch (move.kind) {
    case "draw":
      return `${who} drew a card`;
    case "takePile":
      return `${who} took the pile (${cards})`;
    case "meld":
      return `${who} melded ${cards}`;
    case "takeBack":
      return `${who} took back ${you ? "your" : "their"} melds`;
    case "discard":
      return move.card ? `${who} discarded ${cardShort(move.card)}` : `${who} discarded`;
  }
}

/** How many past moves the side panel lists. */
export const MOVES_KEPT = 3;

/**
 * The list kept as moves arrive: each move once (by `seq`), newest last, the
 * oldest dropped past `MOVES_KEPT`. A move that arrives again (every view repeats
 * the latest) leaves the list as it was.
 */
export function withMove(
  list: readonly { readonly seq: number; readonly text: string }[],
  seq: number,
  text: string,
): { readonly seq: number; readonly text: string }[] {
  if (list.some((item) => item.seq === seq)) return [...list];
  return [...list, { seq, text }].slice(-MOVES_KEPT);
}
