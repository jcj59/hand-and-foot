import { type Action, type Card, type GameState, isRedThree, isWild } from "@hf/shared";
import { activeCards } from "./core";
import { greedyLayDown } from "./plan";
import { cardValue } from "./scoring";

/**
 * How reluctant the policy is to part with a card. Higher is kept longer.
 *
 * Wilds sit above everything so they are never thrown; red threes sit below
 * everything because holding one costs 500 at scoring, which dwarfs any use the
 * card could have (it can never be melded). In between, a card is worth keeping
 * in proportion to the company it keeps: cards that already have a meld to join
 * are the most useful, then cards with partners in hand, and a lone card of a
 * rank nobody is collecting is dead weight.
 */
function keepScore(card: Card, state: GameState, seat: number): number {
  if (isWild(card.rank)) return Number.POSITIVE_INFINITY;
  if (isRedThree(card)) return Number.NEGATIVE_INFINITY;

  const player = state.players[seat];
  const zone = activeCards(player);
  const companions = zone.filter((c) => c.id !== card.id && c.rank === card.rank).length;
  const hasMeld = player.melds.some((m) => m.rank === card.rank);
  // A meld to join beats any number of loose partners: one card completes it.
  return hasMeld ? 100 + companions : companions;
}

/**
 * The card the default policy would throw: the least useful card in the active
 * zone, shedding the highest point value where usefulness ties, since a card
 * still held when the round ends is subtracted at face value.
 *
 * Returns null only when the zone is empty, which cannot happen on a live turn —
 * the draw phase always puts a card in hand first.
 */
export function chooseDiscard(state: GameState, seat: number): Card | null {
  const zone = activeCards(state.players[seat]);
  if (zone.length === 0) return null;

  let best = zone[0];
  let bestKeep = keepScore(best, state, seat);
  for (const card of zone.slice(1)) {
    const keep = keepScore(card, state, seat);
    const value = cardValue(card, state.config);
    const bestValue = cardValue(best, state.config);
    // Least useful first; among equally useless cards, shed the most points.
    // The id comparison is only a tie-breaker, but it has to be there: the
    // policy feeds the action log, so it must be deterministic to replay.
    const better =
      keep < bestKeep ||
      (keep === bestKeep && value > bestValue) ||
      (keep === bestKeep && value === bestValue && card.id < best.id);
    if (better) {
      best = card;
      bestKeep = keep;
    }
  }
  return best;
}

/**
 * The move the server plays for a player who ran out of time or dropped off.
 *
 * It is a pure function of the state — no clock, no I/O — so a timed-out move
 * replays exactly like a chosen one, and the server stays the only thing that
 * knows what time it is.
 *
 * **This is a safe default, not a playing strategy.** It never melds except to
 * settle an obligation, because laying a player's cards down while they are away
 * commits them to a position they never chose. The consequence is that a table
 * of nothing but defaults never ends a round (nobody gets down, so nobody goes
 * out); an abandoned room has to be reaped by the server rather than left to
 * finish. A heuristic strong enough to be the agent's evaluation baseline is a
 * different, later thing — it belongs here beside this one, and will share the
 * discard heuristic, but it is not this function.
 *
 * The three cases:
 *
 * - **Draw phase** — draw from the stock. Never take the pile: taking creates an
 *   obligation to play a pile card, and handing an absent player an obligation
 *   is the last thing to do on their behalf.
 * - **Play phase owing a pile card** — discharge the obligation, because a
 *   discard is refused until it is settled. `greedyLayDown` is the same search
 *   that authorized the take, so it finds a plan whenever one exists.
 * - **Play phase otherwise** — discard by the heuristic above, ending the turn.
 *
 * Returns null when the round has ended and no action would be accepted.
 */
export function defaultAction(state: GameState): Action | null {
  if (state.roundEnded) return null;

  const seat = state.currentSeat;
  const player = state.players[seat];

  if (state.phase === "draw") {
    return { type: "draw" };
  }

  const owed = player.pickedUp ?? [];
  if (owed.length > 0) {
    const plan = greedyLayDown(activeCards(player), player.melds, new Set(owed), state.config);
    // Unreachable: taking the pile required a plan over these same cards, and a
    // lay-down that skipped the obligation can only have consumed naturals of a
    // rank it then melded — which leaves that rank extendable by the one pile
    // card. Guarded rather than asserted, so a future rule change surfaces as a
    // stuck seat the server can report instead of an illegal action.
    /* v8 ignore next */
    if (!plan.usesRequired) return null;
    return { type: "playMelds", melds: plan.plays };
  }

  // Also unreachable: the draw phase puts a card in the active zone before the
  // play phase can be entered, so there is always something to throw.
  const card = chooseDiscard(state, seat);
  /* v8 ignore next */
  if (card === null) return null;
  return { type: "discard", cardId: card.id };
}
