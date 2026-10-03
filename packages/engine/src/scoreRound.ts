import type { GameState, RoundScore } from "@hf/shared";
import { isRedThree } from "@hf/shared";
import { cardValue, classifyBook } from "./scoring";

// Defined in the shared package so the client can render a scoreboard without
// depending on the engine; re-exported here so engine consumers keep finding it.
export type { RoundScore };

/**
 * Score a completed round for every player: the point value of all melded cards,
 * plus book bonuses (clean and dirty), plus the go-out bonus for the player who
 * actually went out, minus the face value of every card still held in hand or foot
 * (so a held red three costs 500 and a held black three costs 5).
 *
 * The bonus is keyed on `wentOutSeat` rather than on holding no cards, because a
 * player can shed every card without the go-out books and keep playing; being
 * cardless when someone else ends the round earns nothing.
 */
export function scoreRound(state: GameState): readonly RoundScore[] {
  const s = state.config.scoring;
  return state.players.map((player, seat) => {
    let cleanBooks = 0;
    let dirtyBooks = 0;
    let meldedCards = 0;
    for (const meld of player.melds) {
      for (const c of meld.cards) meldedCards += cardValue(c, state.config);
      const kind = classifyBook(meld);
      if (kind === "clean") cleanBooks++;
      else if (kind === "dirty") dirtyBooks++;
    }
    const held = [...player.hand, ...player.foot];
    let heldPenalty = 0;
    for (const c of held) heldPenalty -= Math.abs(cardValue(c, state.config));
    const breakdown = {
      cleanBooks,
      dirtyBooks,
      bookBonus: cleanBooks * s.cleanBookBonus + dirtyBooks * s.dirtyBookBonus,
      meldedCards,
      goOutBonus: seat === state.wentOutSeat ? s.goOutBonus : 0,
      heldCount: held.length,
      heldPenalty,
      redThreesHeld: held.filter(isRedThree).length,
    };
    const score =
      breakdown.bookBonus + breakdown.meldedCards + breakdown.goOutBonus + breakdown.heldPenalty;
    return { seat, score, breakdown };
  });
}
