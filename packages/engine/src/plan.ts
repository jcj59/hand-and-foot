import {
  type Card,
  type Meld,
  type MeldPlay,
  type Rank,
  type RulesConfig,
  isBlackThree,
  isRedThree,
  isWild,
} from "@hf/shared";
import { validateMeld } from "./meld";
import { cardValue, classifyBook } from "./scoring";

export interface LayDown {
  readonly plays: readonly MeldPlay[];
  /** Point value of the lay-down, including any clean book it completes. */
  readonly value: number;
  /** Whether the plan plays at least one card from `requiredIds`. */
  readonly usesRequired: boolean;
}

/** What the search is looking for, beyond playing a required card. */
export interface LayDownGoal {
  /** The points the lay-down must reach; zero for a player already down. */
  readonly minimum?: number;
  /**
   * Whether the cards are the player's foot. Black threes are meldable only from
   * the foot, as a book of seven or more, so only then does the search use them.
   * Required rather than defaulted: a caller that forgot it would quietly refuse a
   * take its partner allowed.
   */
  readonly inFoot: boolean;
}

/** Cards in a black-three book: the fewest that may be melded, per `applyPlayMelds`. */
const BLACK_THREE_BOOK = 7;

/** One group of the plan: the cards to lay on `rank`, and what is already there. */
interface Group {
  readonly rank: Rank;
  readonly existing: readonly Card[];
  readonly naturals: Card[];
  readonly wilds: Card[];
}

/**
 * Canonical order, so the result never depends on the order cards were handed in.
 * Card ids are unique, so no two cards ever compare equal.
 */
function byRankThenId(a: Card, b: Card): number {
  return `${a.rank}|${a.id}` < `${b.rank}|${b.id}` ? -1 : 1;
}

/**
 * The shared lay-down search. It finds a lay-down that plays at least one card
 * from `requiredIds` and, when `minimum` is above zero, is worth at least that —
 * or reports the best it found when there is none.
 *
 * Two callers need this, and they must not disagree. `canTakePile` runs it over
 * the hand plus the pile to decide whether taking the pile is allowed, and the
 * default policy runs it over the active zone — the same cards, once taken — to
 * discharge the obligation that taking the pile creates. If those two searches
 * could differ, a player could be allowed to take the pile and then stranded with
 * no way to satisfy it — so they are one function, and it sorts its input first so
 * that the two orders the cards arrive in cannot change the answer.
 *
 * The search:
 *
 * 1. **Naturals.** Every rank with three or more naturals opens a meld, and every
 *    natural of a rank already melded extends it. That costs nothing. From the
 *    foot, black threes count too, but only seven or more of them, or onto a
 *    black-three book already down.
 * 2. **Wilds, only as needed.** Wilds are worth keeping, so they are spent only
 *    while the goal is unmet, highest value first. First on the required card: a
 *    natural pair that includes one becomes a meld with a wild. Then, while short
 *    of the minimum, on whichever single move adds the most — a wild onto a meld
 *    already in the plan, or a natural pair made a meld with one — within the
 *    table's wild ratio. A required black three short of its seven is made up
 *    with wilds the same way, as a black-three book is the only meld it can join.
 *
 * It is sound, not optimal: every group it returns passes `validateMeld` with the
 * meld it joins, so a plan it returns is always a lay-down the reducer accepts.
 * Missing an exotic lay-down makes it refuse a legal take; returning an illegal
 * one would strand a player who took the pile. Only the first is acceptable.
 */
export function greedyLayDown(
  available: readonly Card[],
  melds: readonly Meld[],
  requiredIds: ReadonlySet<string>,
  config: RulesConfig,
  { minimum = 0, inFoot }: LayDownGoal,
): LayDown {
  const cards = [...available].sort(byRankThenId);
  const naturalsByRank = new Map<Rank, Card[]>();
  const wilds: Card[] = [];
  const blackThrees: Card[] = [];
  for (const c of cards) {
    if (isRedThree(c)) continue;
    if (isBlackThree(c)) {
      if (inFoot) blackThrees.push(c);
      continue;
    }
    if (isWild(c.rank)) {
      wilds.push(c);
      continue;
    }
    naturalsByRank.set(c.rank, [...(naturalsByRank.get(c.rank) ?? []), c]);
  }
  // Most valuable first, so the fewest wilds reach a total. (A wild that came off
  // the pile is placed by its own step below, before any other is spent.)
  wilds.sort((a, b) => cardValue(b, config) - cardValue(a, config) || byRankThenId(a, b));
  const existing = new Map(melds.map((m) => [m.rank, m.cards] as const));

  // Step 1: the free plan, naturals only.
  const groups: Group[] = [];
  const pairs = new Map<Rank, Card[]>();
  for (const [rank, naturals] of naturalsByRank) {
    const before = existing.get(rank);
    if (before || naturals.length >= 3) {
      groups.push({ rank, existing: before ?? [], naturals: [...naturals], wilds: [] });
    } else if (naturals.length === 2) {
      pairs.set(rank, naturals);
    }
  }
  const threesDown = existing.get("3");
  if (blackThrees.length > 0 && (threesDown || blackThrees.length >= BLACK_THREE_BOOK)) {
    groups.push({ rank: "3", existing: threesDown ?? [], naturals: [...blackThrees], wilds: [] });
  }

  const valueOf = (): number => {
    let value = 0;
    for (const g of groups) {
      const laid = [...g.naturals, ...g.wilds];
      value += laid.reduce((sum, c) => sum + cardValue(c, config), 0);
      const combined = [...g.existing, ...laid];
      if (combined.length >= 7 && g.existing.length < 7) {
        value +=
          classifyBook({ rank: g.rank, cards: combined }) === "clean"
            ? config.scoring.cleanBookBonus
            : config.scoring.dirtyBookBonus;
      }
    }
    return value;
  };
  const usesRequired = (): boolean =>
    groups.some((g) => [...g.naturals, ...g.wilds].some((c) => requiredIds.has(c.id)));
  /**
   * Every meld a wild could join: those in the plan, and those already down that
   * the plan adds nothing to yet — a wild can go on a book with no natural of its
   * rank left in hand.
   */
  const targets = (): Group[] => [
    ...groups,
    ...[...existing]
      .filter(([rank]) => !groups.some((g) => g.rank === rank))
      .map(([rank, cards]): Group => ({ rank, existing: cards, naturals: [], wilds: [] })),
  ];
  /** Put a wild on a target, bringing a meld already down into the plan if need be. */
  const place = (g: Group, wild: Card): void => {
    if (!groups.includes(g)) groups.push(g);
    g.wilds.push(wild);
  };
  const accepts = (g: Group, extraWild: Card, extraNaturals: readonly Card[] = []): boolean =>
    validateMeld([...g.existing, ...g.naturals, ...extraNaturals, ...g.wilds, extraWild], config)
      .valid;

  // Step 2a: bring a required card in by making its pair a meld with a wild.
  if (!usesRequired() && wilds.length > 0) {
    for (const [rank, pair] of pairs) {
      if (!pair.some((c) => requiredIds.has(c.id))) continue;
      const group: Group = { rank, existing: [], naturals: [...pair], wilds: [] };
      /* v8 ignore next -- a pair and one wild is valid under every wild ratio */
      if (!accepts(group, wilds[0])) continue;
      group.wilds.push(wilds.shift()!);
      groups.push(group);
      pairs.delete(rank);
      break;
    }
  }

  // Step 2a, for a black three: the book it needs, made up to seven with wilds.
  // `validateMeld` holds the wilds to the table's ratio, so at least four of the
  // seven are threes.
  if (!usesRequired() && blackThrees.some((c) => requiredIds.has(c.id))) {
    const short = BLACK_THREE_BOOK - blackThrees.length;
    const book = [...blackThrees, ...wilds.slice(0, short)];
    if (short <= wilds.length && validateMeld(book, config).valid) {
      groups.push({
        rank: "3",
        existing: [],
        naturals: [...blackThrees],
        wilds: wilds.splice(0, short),
      });
    }
  }

  // Step 2a, the other way in: the required card is itself a wild — the pile's
  // top is a two or a joker. It goes wherever it adds the most: onto a meld in the
  // plan or already down, or with a natural pair to make a new one.
  const requiredWild = wilds.find((c) => requiredIds.has(c.id));
  if (!usesRequired() && requiredWild) {
    const before = valueOf();
    let best: { gain: number; apply: () => void } | null = null;
    for (const g of targets()) {
      if (!accepts(g, requiredWild)) continue;
      const added = !groups.includes(g);
      place(g, requiredWild);
      const gain = valueOf() - before;
      g.wilds.pop();
      if (added) groups.pop();
      if (!best || gain > best.gain) best = { gain, apply: () => place(g, requiredWild) };
    }
    for (const [rank, pair] of pairs) {
      const group: Group = { rank, existing: [], naturals: [...pair], wilds: [requiredWild] };
      groups.push(group);
      const gain = valueOf() - before;
      groups.pop();
      if (!best || gain > best.gain) {
        best = {
          gain,
          apply: () => {
            groups.push(group);
            pairs.delete(rank);
          },
        };
      }
    }
    if (best) {
      best.apply();
      wilds.splice(wilds.indexOf(requiredWild), 1);
    }
  }

  // Step 2b: spend wilds while the total is short, on the best single move.
  while (valueOf() < minimum && wilds.length > 0) {
    const wild = wilds[0];
    const before = valueOf();
    let best: { gain: number; apply: () => void } | null = null;
    // Only the melds in the plan: this runs only short of a minimum, which only a
    // player not yet down has, and a player not yet down has no melds on the table.
    for (const g of groups) {
      if (!accepts(g, wild)) continue;
      g.wilds.push(wild);
      const gain = valueOf() - before;
      g.wilds.pop();
      if (!best || gain > best.gain) best = { gain, apply: () => g.wilds.push(wild) };
    }
    for (const [rank, pair] of pairs) {
      const group: Group = { rank, existing: [], naturals: [...pair], wilds: [wild] };
      /* v8 ignore next -- a pair and one wild is valid under every wild ratio */
      if (!validateMeld([...pair, wild], config).valid) continue;
      groups.push(group);
      const gain = valueOf() - before;
      groups.pop();
      if (!best || gain > best.gain) {
        best = {
          gain,
          apply: () => {
            groups.push(group);
            pairs.delete(rank);
          },
        };
      }
    }
    if (!best) break;
    best.apply();
    wilds.shift();
  }

  const plays: MeldPlay[] = groups.map((g) => ({
    rank: g.rank,
    cardIds: [...g.naturals, ...g.wilds].map((c) => c.id),
  }));
  return { plays, value: valueOf(), usesRequired: usesRequired() };
}
