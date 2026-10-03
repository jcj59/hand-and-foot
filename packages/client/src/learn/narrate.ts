/**
 * The demo game in words: what each move did, and, where the table can tell, why.
 * Worked out from the timeline's positions, as anyone watching could: whether the
 * pile could have been taken is the reducer's own test, a lay-down's worth is the points on
 * the table, and a discarded red three is one that could never have been melded.
 */
import { isRedThree, type Rank } from "@hf/shared";
import {
  canTakePile,
  gotDownByMarva,
  layDownMinimum,
  layDownValue,
  type Timeline,
} from "@hf/engine";

const RANK_WORDS: Partial<Record<Rank, string>> = {
  J: "jack",
  Q: "queen",
  K: "king",
  A: "ace",
  JOKER: "joker",
};

/** A rank as it is said: "a 9", "an 8", "an ace", "a king". */
const aRank = (rank: Rank): string => {
  const word = RANK_WORDS[rank] ?? rank;
  return `${rank === "8" || rank === "A" ? "an" : "a"} ${word}`;
};

export function narrate(timeline: Timeline, step: number): string {
  if (step === 0) {
    return "Each player is dealt a hand and a foot. Watch the computer players play a round.";
  }
  const { seat, action } = timeline.entry(step);
  const before = timeline.stateAt(step - 1);
  const after = timeline.stateAt(step);
  const name = timeline.nameOf(seat);
  switch (action.type) {
    case "draw":
      return canTakePile(before, seat).feasible
        ? `${name} drew from the stock rather than take the pile.`
        : before.discard.length === 0
          ? `${name} drew from the stock: there was no pile to take.`
          : `${name} drew from the stock: nothing in the pile could be melded with their cards at once.`;
    case "takePile":
      return `${name} took the pile, ${before.discard.length} card${before.discard.length === 1 ? "" : "s"}: a card in it could be melded at once.`;
    case "playMelds": {
      const was = before.players[seat]!;
      const now = after.players[seat]!;
      if (!was.isDown && now.isDown) {
        const value = layDownValue(now.melds, after.config);
        return gotDownByMarva(before, after, seat)
          ? `${name} got down under the Marva rule: worth only ${value}, but it emptied the hand.`
          : `${name} got down with ${value} points, over the ${layDownMinimum(before, seat)} this round needs.`;
      }
      const cards = action.melds.reduce((n, m) => n + m.cardIds.length, 0);
      const out = after.wentOutSeat === seat && before.wentOutSeat === undefined;
      return out
        ? `${name} melded the last cards and went out. Everyone else gets one last turn.`
        : `${name} melded ${cards} more card${cards === 1 ? "" : "s"}${now.inFoot && !was.inFoot ? ", emptied the hand and picked up the foot" : ""}.`;
    }
    case "discard": {
      const card = after.discard.at(-1)!;
      const out = after.wentOutSeat === seat && before.wentOutSeat === undefined;
      if (out) return `${name} discarded the last card and went out. The round is over.`;
      return isRedThree(card)
        ? `${name} discarded a red three, which can never be melded and costs 500 if it is still held at the end.`
        : `${name} discarded ${aRank(card.rank)}, the card least use to them.`;
    }
    case "takeBack":
      return `${name} took back the melds played this turn.`;
    case "nextRound":
      return "The next round is dealt.";
    case "removePlayer":
      return `${timeline.nameOf(action.seat)} left the game.`;
  }
}
