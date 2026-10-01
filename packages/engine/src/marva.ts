import type { GameState, Meld, RulesConfig } from "@hf/shared";
import { layDownMinimum } from "./feasibility";
import { cardValue, classifyBook } from "./scoring";

/**
 * What a first lay-down is worth against the round minimum: every card in it at
 * face value, plus the bonus for each book it completes.
 *
 * A player getting down holds no melds before (being down is what melds require),
 * so the melds after the play are exactly the lay-down — which is why this takes
 * the melds rather than the play, and why `applyPlayMelds` and the Marva check
 * below can share it: the minimum and the question "was it waived?" are answered
 * by the same arithmetic.
 */
export function layDownValue(melds: readonly Meld[], config: RulesConfig): number {
  let value = 0;
  for (const meld of melds) {
    value += meld.cards.reduce((sum, c) => sum + cardValue(c, config), 0);
    const kind = classifyBook(meld);
    if (kind === "clean") value += config.scoring.cleanBookBonus;
    else if (kind === "dirty") value += config.scoring.dirtyBookBonus;
  }
  return value;
}

/**
 * Whether a play got `seat` down only because of the Marva rule: they were not
 * down before it, are down after it, and what they laid is worth less than the
 * round's minimum — which the reducer allows only when the rule is on and the
 * play emptied the hand. A lay-down that empties the hand but reaches the
 * minimum anyway did not need the rule, and is not a Marva.
 *
 * The table celebrates it, so it is decided here, from the same arithmetic the
 * reducer applied, rather than guessed at by a client.
 */
export function gotDownByMarva(before: GameState, after: GameState, seat: number): boolean {
  const now = after.players[seat]!;
  if (!now.isDown || !before.config.marvaRule) return false;
  // A player already down has no minimum left (`layDownMinimum` is 0), so nothing
  // they play is below it: only a first lay-down can be a Marva.
  return layDownValue(now.melds, before.config) < layDownMinimum(before, seat);
}
