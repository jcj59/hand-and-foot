/**
 * Filler play for scenarios: enough of a player to carry a game from one scripted
 * situation to the next — to the end of a round, or through a whole match —
 * without anyone writing out every draw and discard.
 *
 * It is not the heuristic bot (roadmap item 7) and not an evaluation baseline. It
 * exists so that scripts stay short, and it only has to be legal, deterministic,
 * and good enough that rounds actually end; `defaultAction` is none of the last,
 * since it never melds. It reuses the engine's own searches — `canTakePile`,
 * `greedyLayDown`, `chooseDiscard` — so whatever it plays, the reducer accepts.
 */
import { type Action, type Card, type GameState, type MeldPlay, isWild } from "@hf/shared";
import {
  applyAction,
  bookCounts,
  canTakePile,
  defaultAction,
  greedyLayDown,
  layDownMinimum,
  validateMeld,
} from "@hf/engine";

/** The move the autopilot makes now, or null once the round is over. */
export function autopilotAction(state: GameState): Action | null {
  if (state.roundEnded) return null;
  const seat = state.currentSeat;
  const player = state.players[seat]!;

  if (state.phase === "draw") {
    return canTakePile(state, seat).feasible ? { type: "takePile" } : { type: "draw" };
  }
  // A pile taken has to be paid for before anything else; the default policy
  // settles it with the same search that allowed the take.
  if ((player.pickedUp ?? []).length > 0) return defaultAction(state);

  const zone = player.inFoot ? player.foot : player.hand;
  const melds = meldPlays(state, zone);
  if (melds) return { type: "playMelds", melds };
  return defaultAction(state);
}

/**
 * Something worth melding now, if there is anything: whatever naturals the
 * lay-down search finds (reaching the minimum, if not yet down), and otherwise a
 * wild towards a book. Never a play that sheds the last card without going out —
 * an empty foot without the books leaves a player with nothing to do but draw.
 */
function meldPlays(state: GameState, zone: readonly Card[]): MeldPlay[] | null {
  const seat = state.currentSeat;
  const player = state.players[seat]!;
  const minimum = layDownMinimum(state, seat);
  const plan = greedyLayDown(zone, player.melds, new Set(), state.config, {
    minimum,
    inFoot: player.inFoot,
  });
  const candidates: MeldPlay[][] = [];
  if (plan.plays.length > 0 && plan.value >= minimum) candidates.push([...plan.plays]);
  if (player.isDown) {
    const wild = wildTowardsBook(state, zone);
    if (wild) candidates.push([wild]);
  }
  for (const plays of candidates) {
    const keep = keepingOne(state, zone, plays);
    if (keep) return keep;
  }
  return null;
}

/**
 * A wild onto the meld closest to a book, among those that would still be valid.
 * While the player lacks the clean book they need, their largest clean meld is
 * left clean — a wild on it would cost the 500 that makes going out possible.
 */
function wildTowardsBook(state: GameState, zone: readonly Card[]): MeldPlay | null {
  const player = state.players[state.currentSeat]!;
  const wild = zone.find((c) => isWild(c.rank));
  if (!wild) return null;
  const open = player.melds.filter((m) => m.cards.length < 7);
  const clean = open.filter((m) => !m.cards.some((c) => isWild(c.rank)));
  const needClean = bookCounts(player).clean < state.config.goOutCleanBooks;
  const spare =
    needClean && clean.length > 0
      ? clean.reduce((a, b) => (b.cards.length > a.cards.length ? b : a))
      : null;
  const targets = open
    .filter((m) => m !== spare && m.cards.length >= 4)
    .filter((m) => validateMeld([...m.cards, wild], state.config).valid)
    .sort((a, b) => b.cards.length - a.cards.length);
  const target = targets[0];
  return target ? { rank: target.rank, cardIds: [wild.id] } : null;
}

/**
 * The plays, unless they would empty the zone without going out — in which case
 * the same plays less one card, so there is still a card to discard, or nothing.
 * Emptying the hand is fine: that is how the foot is picked up.
 */
function keepingOne(state: GameState, zone: readonly Card[], plays: MeldPlay[]): MeldPlay[] | null {
  const player = state.players[state.currentSeat]!;
  const played = plays.reduce((n, p) => n + p.cardIds.length, 0);
  const empties = played === zone.length;
  if (!empties || !player.inFoot) return accepted(state, plays);
  const out = applyAction(state, { type: "playMelds", melds: plays });
  if (out.ok && out.state.wentOutSeat === state.currentSeat) return plays;
  // Hold one card back: the last card of a play that still makes a valid meld without it.
  for (let i = plays.length - 1; i >= 0; i--) {
    const trimmed = plays.map((p, j) => (j === i ? { ...p, cardIds: p.cardIds.slice(0, -1) } : p));
    const kept = accepted(
      state,
      trimmed.filter((p) => p.cardIds.length > 0),
    );
    if (kept) return kept;
  }
  return null;
}

/** The plays, if the reducer would take them as they are. */
function accepted(state: GameState, plays: MeldPlay[]): MeldPlay[] | null {
  if (plays.length === 0) return null;
  return applyAction(state, { type: "playMelds", melds: plays }).ok ? plays : null;
}
