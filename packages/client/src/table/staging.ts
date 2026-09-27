/**
 * Building a lay-down before committing it.
 *
 * The rules require this shape: the per-round minimum is checked across an entire
 * lay-down at once, so a player has to be able to assemble several melds and see
 * what they are worth *before* anything is submitted. One meld at a time would be
 * refused for being below the minimum even when the whole lay-down clears it.
 *
 * Every rule consulted here comes from the engine — `validateMeld`, `naturalRank`,
 * `cardValue`, `classifyBook` — and the minimum is computed the same way
 * `applyPlayMelds` computes it, including the book bonuses that count toward it and
 * the Marva exception that waives it. This is a **preview, not an authority**: the
 * server validates the submission regardless, and the point of reusing its
 * predicates is that the preview cannot quietly disagree with the answer.
 *
 * Staging is deliberately a plain value with pure transitions rather than state
 * scattered through the component, because the interesting behaviour — what a wild
 * attaches to, what clears the minimum, when the obligation is met — is all here
 * and can be asserted without rendering anything.
 */
import {
  isBlackThree,
  isRedThree,
  isWild,
  type Card,
  type Meld,
  type MeldPlay,
  type Rank,
  type RulesConfig,
} from "@hf/shared";
import { cardValue, classifyBook, naturalRank, validateMeld } from "@hf/engine";

export interface StagedGroup {
  readonly rank: Rank;
  /** In the order they were staged, which is the order they are submitted. */
  readonly cardIds: readonly string[];
}

export interface Staging {
  readonly groups: readonly StagedGroup[];
  /**
   * The group a wild will attach to. A wild has no rank of its own, so something
   * has to say which book it is being spent on, and the last group touched is the
   * one the player is thinking about.
   */
  readonly focusedRank: Rank | null;
}

export const EMPTY_STAGING: Staging = { groups: [], focusedRank: null };

/** Every card id currently staged, so the hand can show them as lifted. */
export function stagedIds(staging: Staging): ReadonlySet<string> {
  return new Set(staging.groups.flatMap((group) => group.cardIds));
}

/** How many cards are staged in total. */
export function stagedCount(staging: Staging): number {
  return staging.groups.reduce((total, group) => total + group.cardIds.length, 0);
}

/**
 * Focus a rank, creating an empty group for it if there is none.
 *
 * Creating one matters for extending a book already on the table: the player has a
 * book of kings and one wild to add, and with no natural king to start a group
 * there would otherwise be nothing for the wild to attach to.
 */
export function focusGroup(staging: Staging, rank: Rank): Staging {
  const exists = staging.groups.some((group) => group.rank === rank);
  return {
    groups: exists ? staging.groups : [...staging.groups, { rank, cardIds: [] }],
    focusedRank: rank,
  };
}

/**
 * Stage one card.
 *
 * A natural goes to its own rank, creating that group if needed, and focuses it — a
 * player reaching for a wild next means it for the book they were just building.
 * A wild goes to the focused group and nowhere otherwise, because guessing which
 * book to spend it on would be guessing at the one decision a wild involves.
 *
 * A red three is refused: it can never be melded, and the engine says so too.
 */
export function stageCard(staging: Staging, card: Card): Staging {
  if (isRedThree(card)) return staging;
  if (stagedIds(staging).has(card.id)) return staging;

  if (isWild(card.rank)) {
    // Provably equivalent to falling through — `addTo` with a null rank matches no
    // group and returns the same value — so no test can kill this line. It stays
    // because relying on that coincidence would hide the actual rule, which is that
    // a wild needs a target before it can be staged at all.
    if (staging.focusedRank === null) return staging;
    return addTo(staging, staging.focusedRank, card.id);
  }
  return addTo(focusGroup(staging, card.rank), card.rank, card.id);
}

function addTo(staging: Staging, rank: Rank, cardId: string): Staging {
  return {
    ...staging,
    groups: staging.groups.map((group) =>
      group.rank === rank ? { ...group, cardIds: [...group.cardIds, cardId] } : group,
    ),
  };
}

/** Take a card back out. A group left empty is dropped, along with its focus. */
export function unstageCard(staging: Staging, cardId: string): Staging {
  const groups = staging.groups
    .map((group) => ({ ...group, cardIds: group.cardIds.filter((id) => id !== cardId) }))
    .filter((group) => group.cardIds.length > 0);
  const focusStillThere = groups.some((group) => group.rank === staging.focusedRank);
  return { groups, focusedRank: focusStillThere ? staging.focusedRank : null };
}

/** What crosses the wire. Empty groups are dropped: the engine rejects them. */
export function toMeldPlays(staging: Staging): MeldPlay[] {
  return staging.groups
    .filter((group) => group.cardIds.length > 0)
    .map((group) => ({ rank: group.rank, cardIds: [...group.cardIds] }));
}

export interface GroupPreview {
  readonly rank: Rank;
  readonly cardIds: readonly string[];
  /** Total size once added to whatever is already on the table for this rank. */
  readonly combinedSize: number;
  /** Null when the group is a legal meld; otherwise the engine's own reason. */
  readonly problem: string | null;
  /** How this book would be classified if submitted as it stands. */
  readonly kind: "clean" | "dirty" | "incomplete";
}

export interface LayDownPreview {
  readonly groups: readonly GroupPreview[];
  /** Card values of everything staged, plus any book bonus newly earned. */
  readonly value: number;
  /** The round's minimum. Zero once the player is down — it no longer applies. */
  readonly minimum: number;
  /** True when the whole lay-down would be accepted. */
  readonly ok: boolean;
  /** Everything wrong with it, in the engine's words where possible. */
  readonly problems: readonly string[];
  /** The minimum is waived because this lay-down empties the hand (Marva). */
  readonly marvaWaived: boolean;
  /** True when submitting would move the player into their foot. */
  readonly emptiesHand: boolean;
}

export interface PreviewParams {
  readonly staging: Staging;
  /** The player's active zone: the hand, or the foot once they are in it. */
  readonly zone: readonly Card[];
  readonly melds: readonly Meld[];
  readonly config: RulesConfig;
  readonly roundNumber: number;
  readonly isDown: boolean;
  readonly inFoot: boolean;
  /** Cards left in the foot, which decides whether emptying the hand is possible. */
  readonly footCount: number;
}

/**
 * What would happen if this lay-down were submitted now.
 *
 * Mirrors `applyPlayMelds` step for step, because a preview that disagreed with the
 * reducer would be worse than none: the player would be told a lay-down is good and
 * then have it refused.
 */
export function previewLayDown(params: PreviewParams): LayDownPreview {
  const { staging, zone, melds, config, roundNumber, isDown, inFoot, footCount } = params;
  const byId = new Map(zone.map((card) => [card.id, card]));
  const existing = new Map(melds.map((meld) => [meld.rank, meld.cards]));
  const problems: string[] = [];

  const groups: GroupPreview[] = staging.groups.map((group) => {
    const staged = group.cardIds.map((id) => byId.get(id)).filter((card): card is Card => !!card);
    const before = existing.get(group.rank) ?? [];
    const combined = [...before, ...staged];
    const problem = groupProblem(combined, staged, group.rank, config, inFoot);
    if (problem) problems.push(problem);
    return {
      rank: group.rank,
      cardIds: group.cardIds,
      combinedSize: combined.length,
      problem,
      kind:
        combined.length === 0 ? "incomplete" : classifyBook({ rank: group.rank, cards: combined }),
    };
  });

  const laid = staging.groups
    .flatMap((group) => group.cardIds)
    .map((id) => byId.get(id))
    .filter((card): card is Card => !!card);

  // The value that counts toward the minimum: card values, plus a book bonus for
  // each meld that crosses seven having been below it. Exactly what the reducer adds.
  let value = laid.reduce((sum, card) => sum + cardValue(card, config), 0);
  for (const group of groups) {
    const before = (existing.get(group.rank) ?? []).length;
    if (group.combinedSize >= 7 && before < 7) {
      value +=
        group.kind === "clean" ? config.scoring.cleanBookBonus : config.scoring.dirtyBookBonus;
    }
  }

  const emptiesHand = !inFoot && zone.length - laid.length === 0 && footCount > 0;
  // The minimum only applies to getting down; afterwards any legal meld is fine.
  const minimum = isDown ? 0 : (config.layDownMinimums[roundNumber - 1] ?? 0);
  const marvaWaived = !isDown && config.marvaRule && emptiesHand && value < minimum;
  if (!isDown && value < minimum && !marvaWaived) {
    problems.push(`this lay-down is worth ${value}, below the round minimum of ${minimum}`);
  }
  if (staging.groups.every((group) => group.cardIds.length === 0)) {
    problems.push("nothing is staged yet");
  }

  return {
    groups,
    value,
    minimum,
    ok: problems.length === 0,
    problems,
    marvaWaived,
    emptiesHand,
  };
}

/** One group's legality, in the same order the reducer checks it. */
function groupProblem(
  combined: readonly Card[],
  staged: readonly Card[],
  rank: Rank,
  config: RulesConfig,
  inFoot: boolean,
): string | null {
  if (staged.length === 0) return null;
  if (staged.some(isRedThree)) return "red threes can never be melded";
  if (combined.some(isBlackThree)) {
    if (!inFoot) return "black threes can only be melded from the foot";
    if (combined.length < 7) return "black threes can only be melded as a book of seven or more";
  }
  const validation = validateMeld(combined, config);
  if (!validation.valid) return validation.reason;
  const natural = naturalRank(combined);
  if (natural !== null && natural !== rank) {
    return `meld declared as rank ${rank} but its natural cards are ${natural}`;
  }
  return null;
}

/**
 * Whether the take-pile obligation is settled by this lay-down.
 *
 * Taking the pile owes at least one of the cards taken to a meld before the turn can
 * end. The client knows which cards are owed — `pickedUp` is in the view — so it can
 * say whether a discard will be refused before the player tries it.
 */
export function settlesObligation(staging: Staging, pickedUp: readonly string[]): boolean {
  if (pickedUp.length === 0) return true;
  const staged = stagedIds(staging);
  return pickedUp.some((id) => staged.has(id));
}
