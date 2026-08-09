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
import { cardValue } from "./scoring";

export interface LayDown {
  readonly plays: readonly MeldPlay[];
  /** Point value of the lay-down, including any clean book it completes. */
  readonly value: number;
  /** Whether the plan plays at least one card from `requiredIds`. */
  readonly usesRequired: boolean;
}

/**
 * The shared lay-down search: group the available naturals by rank, form a new
 * meld wherever there are three or more, extend an existing meld wherever there
 * is even one, and report the total value.
 *
 * Two callers need this, and they must not disagree. `canTakePile` runs it over
 * the hand plus the pile to decide whether taking the pile is allowed, and the
 * default policy runs it over the active zone to discharge the obligation that
 * taking the pile creates. If those two searches could differ, a player could be
 * allowed to take the pile and then stranded with no way to satisfy it — so they
 * are one function.
 *
 * It is deliberately simple rather than optimal: it never allocates wilds, which
 * makes it conservative in wild-heavy positions. What matters is soundness — a
 * plan it returns is always a legal lay-down — not that it finds the best one.
 * The agent milestone is where the search gets smarter.
 */
export function greedyLayDown(
  available: readonly Card[],
  melds: readonly Meld[],
  requiredIds: ReadonlySet<string>,
  config: RulesConfig,
): LayDown {
  const naturalsByRank = new Map<Rank, Card[]>();
  for (const c of available) {
    if (isWild(c.rank) || isRedThree(c) || isBlackThree(c)) continue;
    const arr = naturalsByRank.get(c.rank);
    if (arr) arr.push(c);
    else naturalsByRank.set(c.rank, [c]);
  }
  const existing = new Map(melds.map((m) => [m.rank, m.cards.length] as const));

  const plays: MeldPlay[] = [];
  let value = 0;
  let usesRequired = false;
  for (const [rank, naturals] of naturalsByRank) {
    const hasExisting = existing.has(rank);
    const canForm = hasExisting ? naturals.length >= 1 : naturals.length >= 3;
    if (!canForm) continue;
    // Defensive, and currently unreachable: `naturals` is three or more cards of a
    // single rank with no wilds, which every wild-ratio setting accepts. It becomes
    // live the moment the search starts allocating wilds into plans, so it stays.
    /* v8 ignore next */
    if (!hasExisting && !validateMeld(naturals, config).valid) continue;

    plays.push({ rank, cardIds: naturals.map((c) => c.id) });
    value += naturals.reduce((sum, c) => sum + cardValue(c, config), 0);
    const total = (existing.get(rank) ?? 0) + naturals.length;
    if (total >= 7 && (existing.get(rank) ?? 0) < 7) {
      value += config.scoring.cleanBookBonus;
    }
    if (naturals.some((c) => requiredIds.has(c.id))) {
      usesRequired = true;
    }
  }
  return { plays, value, usesRequired };
}
