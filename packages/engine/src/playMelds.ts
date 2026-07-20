import type { Card, GameState, Meld, MeldPlay, Rank } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";
import { naturalRank, validateMeld } from "./meld";

/**
 * Lay new melds and extend existing ones from the current player's active zone.
 * Each MeldPlay targets the single meld of its rank (creating it if absent,
 * extending it if present), which is how one-meld-per-rank is enforced: there is
 * never a way to make a second meld of a rank you already hold. The whole
 * submission is validated against a working copy before anything changes, so an
 * invalid submission leaves the state untouched. The getting-down minimum for a
 * player's first lay-down is added in the next diff; this handles the mechanics
 * for a player who is already down.
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
  for (const m of player.melds) melds.set(m.rank, [...m.cards]);

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

  const newMelds: Meld[] = [...melds.entries()].map(([rank, cards]) => ({ rank, cards }));
  return ok(updatePlayer(state, seat, (p) => setActiveCards({ ...p, melds: newMelds }, zone)));
}
