import {
  type Card,
  type GameState,
  type Meld,
  type MeldPlay,
  type Rank,
  isBlackThree,
  isRedThree,
} from "@hf/shared";
import {
  type ApplyResult,
  activeCards,
  advanceTurn,
  fail,
  ok,
  setActiveCards,
  updatePlayer,
} from "./core";
import { naturalRank, validateMeld } from "./meld";
import { cardValue, classifyBook } from "./scoring";
import { claimsGoOut } from "./goout";

/**
 * Lay new melds and extend existing ones from the current player's active zone.
 * Each MeldPlay targets the single meld of its rank, enforcing one meld per rank
 * per player. The submission is validated against a working copy before anything
 * changes, so an invalid submission leaves state untouched.
 *
 * Rules layered here: the getting-down minimum (with the Marva exception), red
 * threes never meldable and black threes only from the foot as a book of seven,
 * the take-pile obligation, foot pickup when the hand empties, and the two ways
 * melding can empty the foot — going out without a discard when the go-out books
 * are held (starting a final lap for the other players), or merely shedding every
 * card without them, which ends the turn and leaves the player cardless.
 */
export function applyPlayMelds(state: GameState, plays: readonly MeldPlay[]): ApplyResult {
  if (state.phase !== "play") {
    return fail("melds can only be played during the play phase");
  }
  if (plays.length === 0) {
    return fail("no melds were submitted");
  }

  const seat = state.currentSeat;
  const player = state.players[seat];
  let zone: Card[] = [...activeCards(player)];
  const melds = new Map<Rank, Card[]>();
  const beforeSize = new Map<Rank, number>();
  for (const m of player.melds) {
    melds.set(m.rank, [...m.cards]);
    beforeSize.set(m.rank, m.cards.length);
  }

  const laid: Card[] = [];
  for (const play of plays) {
    const taken: Card[] = [];
    for (const id of play.cardIds) {
      const idx = zone.findIndex((c) => c.id === id);
      if (idx === -1) {
        return fail(`card ${id} is not available to play`);
      }
      taken.push(zone[idx]);
      zone = [...zone.slice(0, idx), ...zone.slice(idx + 1)];
    }
    if (taken.some(isRedThree)) {
      return fail("red threes can never be melded");
    }
    laid.push(...taken);
    const combined = [...(melds.get(play.rank) ?? []), ...taken];
    if (combined.some(isBlackThree)) {
      if (!player.inFoot) {
        return fail("black threes can only be melded from the foot");
      }
      if (combined.length < 7) {
        return fail("black threes can only be melded as a book of seven or more");
      }
    }
    const validation = validateMeld(combined, state.config);
    if (!validation.valid) {
      return fail(validation.reason);
    }
    const nr = naturalRank(combined);
    if (nr !== null && nr !== play.rank) {
      return fail(`meld declared as rank ${play.rank} but its natural cards are ${nr}`);
    }
    melds.set(play.rank, combined);
  }

  const emptiesHand = !player.inFoot && zone.length === 0 && player.foot.length > 0;
  const emptiesFoot = player.inFoot && zone.length === 0;
  let down = player.isDown;
  if (!player.isDown) {
    const minimum = state.config.layDownMinimums[state.roundNumber - 1] ?? 0;
    let value = laid.reduce((sum, c) => sum + cardValue(c, state.config), 0);
    for (const [rank, cards] of melds) {
      const before = beforeSize.get(rank) ?? 0;
      if (cards.length >= 7 && before < 7) {
        const kind = classifyBook({ rank, cards });
        value +=
          kind === "clean"
            ? state.config.scoring.cleanBookBonus
            : state.config.scoring.dirtyBookBonus;
      }
    }
    if (value < minimum && !(state.config.marvaRule && emptiesHand)) {
      return fail(`this lay-down is worth ${value}, below the round minimum of ${minimum}`);
    }
    down = true;
  }

  const owed = player.pickedUp ?? [];
  const obligationMet = owed.length > 0 && laid.some((c) => owed.includes(c.id));
  const newMelds: Meld[] = [...melds.entries()].map(([rank, cards]) => ({ rank, cards }));
  const nextState = updatePlayer(state, seat, (p) => {
    const withZone = setActiveCards({ ...p, melds: newMelds, isDown: down }, zone);
    const withFoot = emptiesHand ? { ...withZone, inFoot: true } : withZone;
    return obligationMet ? { ...withFoot, pickedUp: [] } : withFoot;
  });

  // Melding emptied the foot. For the player going out this is going out without a
  // discard, which starts the final lap. Otherwise — no books, or someone has
  // already gone out and this is the final lap — the player has simply shed every
  // card; there is nothing left to discard, so the turn ends here.
  if (emptiesFoot) {
    if (!claimsGoOut(state, nextState.players[seat])) {
      return ok(advanceTurn(nextState, seat));
    }
    const nextSeat = (seat + 1) % state.players.length;
    return ok({
      ...nextState,
      currentSeat: nextSeat,
      phase: "draw",
      finalLapRemaining: state.players.length - 1,
      wentOutSeat: seat,
    });
  }

  return ok(nextState);
}
