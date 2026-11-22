/**
 * The one discard the table speaks up about: a card that fits one of the
 * player's own melds, said in the card's sheet before the player discards it, so
 * "Discard anyway" is a choice made knowing it.
 *
 * Only the player's own melds count. A wild given away, or a card of a rank
 * another player has down, is the player's own judgment, as at a real table, and
 * is not warned about.
 */
import type { Card, Rank } from "@hf/shared";

const PLURAL: Partial<Record<Rank, string>> = {
  J: "jacks",
  Q: "queens",
  K: "kings",
  A: "aces",
  "3": "threes",
};

/** A rank in the plural, as said at the table: "kings", "8s". */
export function rankPlural(rank: Rank): string {
  return PLURAL[rank] ?? `${rank}s`;
}

/**
 * The warning for discarding `card`, or null. `fitsOwnMeld` is whether it could
 * be laid off on one of the player's melds (`canLayOff`, which never says so of a
 * wild).
 */
export function discardWarning(card: Card, fitsOwnMeld: boolean): string | null {
  return fitsOwnMeld ? `You have ${rankPlural(card.rank)} down; it could go on them.` : null;
}
