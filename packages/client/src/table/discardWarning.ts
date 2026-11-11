/**
 * Why throwing a card away is probably a mistake, said in the card's sheet before
 * the player discards it, so "Discard anyway" is a choice made knowing it.
 *
 * Three reasons, most costly first: a wild given away; a card of a rank another
 * player has down, which lets them take the pile with it (a player who is down
 * may take the pile with a card that extends one of their melds); and a card
 * that could have gone on one of the player's own melds. Only public facts are
 * used: melds are on the table for everyone to see.
 */
import { isWild, type Card, type Rank } from "@hf/shared";

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

/** "Kate", "Kate and Mom", "Kate, Mom and Ben". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface WarningContext {
  /** The player's own melded ranks, and whether the card could be laid off on one. */
  readonly canLayOff: boolean;
  /** Other players (by name) and the ranks they have down. */
  readonly others: readonly { readonly name: string; readonly ranks: ReadonlySet<Rank> }[];
}

export function discardWarning(card: Card, context: WarningContext): string | null {
  if (isWild(card.rank)) return "That is a wild card. Whoever takes the pile gets it.";
  const takers = context.others.filter((o) => o.ranks.has(card.rank)).map((o) => o.name);
  if (takers.length > 0) {
    const verb = takers.length === 1 ? "has" : "have";
    return `${nameList(takers)} ${verb} ${rankPlural(card.rank)} down and could take the pile with this.`;
  }
  if (context.canLayOff) return `You have ${rankPlural(card.rank)} down; it could go on them.`;
  return null;
}
