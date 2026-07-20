import type { GameState } from "@hf/shared";
import { cardValue, classifyBook } from "./scoring";

export interface RoundScore {
  readonly seat: number;
  readonly score: number;
}

/**
 * Score a completed round for every player: the point value of all melded cards,
 * plus book bonuses (clean and dirty), plus the go-out bonus for the player who
 * shed all their cards, minus the face value of every card still held in hand or
 * foot (so a held red three costs 500 and a held black three costs 5).
 */
export function scoreRound(state: GameState): readonly RoundScore[] {
  const s = state.config.scoring;
  return state.players.map((player, seat) => {
    let score = 0;
    for (const meld of player.melds) {
      for (const c of meld.cards) score += cardValue(c, state.config);
      const kind = classifyBook(meld);
      if (kind === "clean") score += s.cleanBookBonus;
      else if (kind === "dirty") score += s.dirtyBookBonus;
    }
    const held = [...player.hand, ...player.foot];
    for (const c of held) score -= Math.abs(cardValue(c, state.config));
    if (held.length === 0) score += s.goOutBonus;
    return { seat, score };
  });
}
