import type { Card, GameState, Meld, MeldPlay, Rank } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";
import { naturalRank, validateMeld } from "./meld";
import { cardValue, classifyBook } from "./scoring";

/**
 * Lay new melds and extend existing ones from the current player's active zone.
 * Each MeldPlay targets the single meld of its rank (creating it if absent,
 * extending it if present), which enforces one meld per rank per player. The
 * whole submission is validated against a working copy before anything changes,
 * so an invalid submission leaves the state untouched.
 *
 * A player who is not yet down must, in this single turn, lay melds whose value
 * meets the round minimum, after which they are marked down and the minimum no
 * longer applies. The value counted is the sum of the face values of the cards
 * laid this turn plus the book bonus for any book (seven or more) completed in
 * the same turn.
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
    laid.push(...taken);
    const combined = [...(melds.get(play.rank) ?? []), ...taken];
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
    if (value < minimum) {
      return fail(`this lay-down is worth ${value}, below the round minimum of ${minimum}`);
    }
    down = true;
  }

  const newMelds: Meld[] = [...melds.entries()].map(([rank, cards]) => ({ rank, cards }));
  return ok(
    updatePlayer(state, seat, (p) => setActiveCards({ ...p, melds: newMelds, isDown: down }, zone)),
  );
}
