import {
  type Action,
  type Card,
  type GameState,
  type Meld,
  type MeldPlay,
  type PlayerView,
  type Rank,
  type RulesConfig,
  isRedThree,
  isWild,
} from "@hf/shared";
import { activeCards } from "./core";
import { layDownMinimum } from "./feasibility";
import { validateMeld } from "./meld";
import { greedyLayDown } from "./plan";
import { cardValue, classifyBook } from "./scoring";

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
function keepScore(card: Card, zone: readonly Card[], melds: readonly Meld[]): number {
  if (isWild(card.rank)) return Number.POSITIVE_INFINITY;
  if (isRedThree(card)) return Number.NEGATIVE_INFINITY;

  const companions = zone.filter((c) => c.id !== card.id && c.rank === card.rank).length;
  const hasMeld = melds.some((m) => m.rank === card.rank);
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
  const player = state.players[seat];
  return discardFrom(activeCards(player), player.melds, state.config);
}

/**
 * `chooseDiscard` over the cards themselves rather than a seat of a `GameState`:
 * the active zone, the seat's own melds, and the rules. Those are all things the
 * seat can see, which is what lets the heuristic below choose its discard from a
 * `PlayerView` with exactly the same judgement the default uses.
 */
export function discardFrom(
  zone: readonly Card[],
  melds: readonly Meld[],
  config: RulesConfig,
): Card | null {
  if (zone.length === 0) return null;

  let best = zone[0];
  let bestKeep = keepScore(best, zone, melds);
  for (const card of zone.slice(1)) {
    const keep = keepScore(card, zone, melds);
    const value = cardValue(card, config);
    const bestValue = cardValue(best, config);
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
 * finish. The heuristic that plays to win, and is the agent's evaluation
 * baseline, is `heuristicAction` below; it shares the discard judgement, but it
 * is not this function.
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
    // The same search, over the same cards, with the same minimum as the take was
    // authorized under — so it finds the plan that authorized it.
    const minimum = layDownMinimum(state, seat);
    const plan = greedyLayDown(
      activeCards(player),
      player.melds,
      new Set(owed),
      state.config,
      minimum,
    );
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

/** Cards in a book: a meld of this many or more is complete. */
const BOOK_SIZE = 7;

/**
 * The most red threes a pile may hold for the heuristic to take it. Each one is
 * worth -500 if still held when the round ends, and only one card leaves the
 * hand per turn by discard, so a pile with several of them is a liability that
 * a handful of playable cards does not pay for. Two was chosen by measurement:
 * played head to head over 500 two-player matches, it beat a limit of one (65%),
 * three (60%) and four (78%), and a limit of none lost nearly nine games in ten.
 */
export const MAX_PILE_RED_THREES = 2;

/** The zone a seat plays from, as its own view shows it. */
function viewZone(view: PlayerView): readonly Card[] {
  // A view carries the foot exactly when the seat is in it.
  return view.inFoot ? view.foot! : view.hand;
}

/** The view-side twin of `layDownMinimum`: the same rule, read from what the seat sees. */
function viewMinimum(view: PlayerView, config: RulesConfig): number {
  if (view.isDown) return 0;
  return config.layDownMinimums[view.roundNumber - 1] ?? 0;
}

/**
 * Whether the heuristic takes the pile. It asks the same search `canTakePile`
 * asks, over the same cards — the seat's own zone and melds and the face-up pile,
 * all of which its view holds — so it never proposes a take the reducer refuses.
 * On top of legality it declines a pile carrying more red threes than it can
 * shed; see `MAX_PILE_RED_THREES`.
 */
function wantsPile(view: PlayerView, config: RulesConfig, minimum: number): boolean {
  const pile = view.discard;
  if (pile.filter(isRedThree).length > MAX_PILE_RED_THREES) return false;
  const plan = greedyLayDown(
    [...viewZone(view), ...pile],
    view.melds,
    new Set(pile.map((c) => c.id)),
    config,
    minimum,
  );
  return plan.usesRequired && plan.value >= minimum;
}

/**
 * Where a down seat's wilds go, given the melds it is about to have once its
 * naturals are played. Wilds are the scarcest cards in the game, so they are
 * spent with a purpose rather than as soon as they fit:
 *
 * - **Never on a clean book**, and never on the seat's best clean prospect while
 *   it still lacks the clean books going out requires — one wild turns a 500
 *   bonus into 300, and can cost the round. The exception is a spare clean book
 *   when a dirty one is missing; see `open` below.
 * - **To complete a book**, in hand or foot: the meld closest to seven that the
 *   wilds in hand can finish within the wild ratio gets as many as it needs.
 * - **Everything else only from the foot.** In the hand a wild is worth more
 *   held, since a natural pair and a wild is how a seat takes the pile; in the
 *   foot the round is closing and a held wild is a 20- or 50-point penalty, so
 *   the rest go one at a time: a spare clean book first, then the unfinished meld
 *   nearest completion, then a dirty book.
 *
 * Returns rank → wild cards to add, for `heuristicAction` to merge with the
 * naturals.
 */
function placeWilds(
  melds: ReadonlyMap<Rank, readonly Card[]>,
  wilds: readonly Card[],
  inFoot: boolean,
  config: RulesConfig,
): Map<Rank, Card[]> {
  const added = new Map<Rank, Card[]>();
  const cardsOf = (rank: Rank): Card[] => [...melds.get(rank)!, ...(added.get(rank) ?? [])];
  const add = (rank: Rank, cards: readonly Card[]): void => {
    added.set(rank, [...(added.get(rank) ?? []), ...cards]);
  };

  /** Books as they would stand with the wilds assigned so far. */
  const books = (): { clean: number; dirty: number } => {
    let clean = 0;
    let dirty = 0;
    for (const rank of melds.keys()) {
      const kind = classifyBook({ rank, cards: cardsOf(rank) });
      if (kind === "clean") clean += 1;
      else if (kind === "dirty") dirty += 1;
    }
    return { clean, dirty };
  };
  // The clean meld nearest to a book, kept clean while a clean book is still owed.
  let prospect: { rank: Rank; size: number } | null = null;
  for (const [rank, cards] of melds) {
    const unbooked = classifyBook({ rank, cards }) === "incomplete";
    if (!unbooked || cards.some((c) => isWild(c.rank))) continue;
    if (!prospect || cards.length > prospect.size) prospect = { rank, size: cards.length };
  }
  const guarded = books().clean < config.goOutCleanBooks ? prospect?.rank : undefined;
  /**
   * Whether a wild may go on this meld. A clean book is closed — unless it is a
   * spare: more clean books than going out needs, and too few dirty ones. Then one
   * wild turns it into the dirty book that is missing. Without this a seat can
   * meld seven clean books, run out of the cards any dirty book could still be
   * made from, and draw and discard threes forever: a round that never ends.
   */
  const open = (rank: Rank): boolean => {
    if (rank === guarded) return false;
    if (classifyBook({ rank, cards: cardsOf(rank) }) !== "clean") return true;
    const { clean, dirty } = books();
    return clean > config.goOutCleanBooks && dirty < config.goOutDirtyBooks;
  };
  // Nearest completion first; the rank breaks ties so the order never depends on
  // the order the melds arrived in.
  const byNearest = (a: Rank, b: Rank): number =>
    cardsOf(b).length - cardsOf(a).length || (a < b ? -1 : 1);

  // Highest value first, as `greedyLayDown` spends them: a joker held at the end
  // costs the most.
  const pool = [...wilds].sort((a, b) => cardValue(b, config) - cardValue(a, config));

  for (const rank of [...melds.keys()].filter(open).sort(byNearest)) {
    const need = BOOK_SIZE - cardsOf(rank).length;
    if (need <= 0 || need > pool.length) continue;
    const use = pool.slice(0, need);
    if (!validateMeld([...cardsOf(rank), ...use], config).valid) continue;
    add(rank, use);
    pool.splice(0, need);
  }

  if (inFoot) {
    for (const wild of pool) {
      // A spare clean book first (one wild makes a missing dirty book outright),
      // then the unfinished melds, then dirty books, where a wild only scores.
      const order = (rank: Rank): number => {
        const kind = classifyBook({ rank, cards: cardsOf(rank) });
        return kind === "clean" ? 0 : kind === "incomplete" ? 1 : 2;
      };
      const target = [...melds.keys()]
        .filter((rank) => open(rank) && validateMeld([...cardsOf(rank), wild], config).valid)
        .sort((a, b) => order(a) - order(b) || byNearest(a, b))[0];
      if (target !== undefined) add(target, [wild]);
    }
  }
  return added;
}

/**
 * A playing heuristic: the move a reasonable player would make from this seat.
 *
 * Where `defaultAction` is a safe stand-in for an absent player and never melds,
 * this one plays to win, and it is the baseline the reinforcement-learning agent
 * is measured against. It shares the default's parts rather than having its own:
 * `greedyLayDown` for every lay-down (so a pile it takes is always a pile it can
 * settle) and `discardFrom` for every discard.
 *
 * **It reads a `PlayerView`, not a `GameState`.** The view is exactly what the
 * seat is sent, so the heuristic cannot see another hand, a foot, or the stock
 * order even by accident — the type does not hold them. The rules config is the
 * only other input, and every seat knows the rules. This is the same
 * observation the agent will have, so the two are compared fairly.
 *
 * It is a pure function of its inputs and does not randomize; the same view
 * always gets the same move, so a game it plays replays exactly.
 *
 * - **Draw phase** — take the pile when the reducer would allow it and it holds
 *   no more than `MAX_PILE_RED_THREES` red threes; otherwise draw.
 * - **Owing a pile card** — settle it, with the search that authorized the take.
 * - **Not down** — get down as soon as `greedyLayDown` reaches the minimum, or
 *   when the lay-down melds the whole hand and the Marva rule waives it.
 * - **Down** — meld every natural that extends a meld or makes a new one, spend
 *   wilds as `placeWilds` decides, and otherwise discard. Shedding the last card
 *   with the books in place is going out, so it goes out as soon as it can.
 *
 * One action per call: a turn is several calls, each on the view the last one
 * produced. Returns null when it is not this seat's turn. A view does not say
 * whether the round has ended, so the caller, which does know, must not ask then.
 */
export function heuristicAction(view: PlayerView, config: RulesConfig): Action | null {
  if (view.currentSeat !== view.seat) return null;

  const zone = viewZone(view);
  const minimum = viewMinimum(view, config);

  if (view.phase === "draw") {
    return wantsPile(view, config, minimum) ? { type: "takePile" } : { type: "draw" };
  }

  if (view.pickedUp.length > 0) {
    const plan = greedyLayDown(zone, view.melds, new Set(view.pickedUp), config, minimum);
    // Unreachable for the reason it is in `defaultAction`: the take was authorized
    // by this search over these cards.
    /* v8 ignore next */
    if (!plan.usesRequired) return null;
    return { type: "playMelds", melds: plan.plays };
  }

  if (!view.isDown) {
    const plan = greedyLayDown(zone, [], new Set(), config, minimum);
    const laid = plan.plays.reduce((n, play) => n + play.cardIds.length, 0);
    // Melding the whole hand gets a seat down below the minimum under the Marva
    // rule. A seat out of its foot always still has the foot to pick up, so
    // emptying the hand here is always emptying it into the foot.
    const marva = config.marvaRule && !view.inFoot && laid === zone.length;
    if (plan.plays.length > 0 && (plan.value >= minimum || marva)) {
      return { type: "playMelds", melds: plan.plays };
    }
  } else {
    const plays = downPlays(zone, view, config);
    if (plays.length > 0) return { type: "playMelds", melds: plays };
  }

  const card = discardFrom(zone, view.melds, config);
  // Unreachable: the play phase always has a card in the zone; see `defaultAction`.
  /* v8 ignore next */
  if (card === null) return null;
  return { type: "discard", cardId: card.id };
}

/**
 * Everything a down seat lays this call: every natural that joins or opens a
 * meld (the free part of `greedyLayDown`, with no minimum to reach), then the
 * wilds `placeWilds` assigns over the melds that leaves.
 */
function downPlays(zone: readonly Card[], view: PlayerView, config: RulesConfig): MeldPlay[] {
  const naturals = greedyLayDown(zone, view.melds, new Set(), config, 0).plays;
  const byId = new Map(zone.map((c) => [c.id, c] as const));
  const melds = new Map<Rank, Card[]>(view.melds.map((m) => [m.rank, [...m.cards]]));
  for (const play of naturals) {
    melds.set(play.rank, [
      ...(melds.get(play.rank) ?? []),
      ...play.cardIds.map((id) => byId.get(id)!),
    ]);
  }
  const wilds = placeWilds(
    melds,
    zone.filter((c) => isWild(c.rank)),
    view.inFoot,
    config,
  );

  const plays = naturals.map((play) => ({
    rank: play.rank,
    cardIds: [...play.cardIds, ...(wilds.get(play.rank) ?? []).map((c) => c.id)],
  }));
  for (const [rank, cards] of wilds) {
    if (!plays.some((play) => play.rank === rank)) {
      plays.push({ rank, cardIds: cards.map((c) => c.id) });
    }
  }
  return plays;
}
