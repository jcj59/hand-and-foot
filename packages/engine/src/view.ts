import type { GameState, OpponentView, PlayerView } from "@hf/shared";

/**
 * Project the authoritative game state into the filtered view a single player is
 * allowed to see. The viewer's own hand is visible, and their own foot only once
 * picked up. Every other hidden zone (opponents' hands, all feet contents, and the
 * stock) is reduced to a count. Public information is passed through unchanged.
 * This is the anti-cheat boundary: it is the only thing a client should receive.
 */
export function project(state: GameState, seat: number): PlayerView {
  const self = state.players[seat];

  const opponents: OpponentView[] = state.players
    .map((player, index) => ({ player, index }))
    .filter(({ index }) => index !== seat)
    .map(({ player, index }) => ({
      seat: index,
      handCount: player.hand.length,
      footCount: player.foot.length,
      melds: player.melds,
      isDown: player.isDown,
      inFoot: player.inFoot,
    }));

  return {
    seat,
    hand: self.hand,
    foot: self.inFoot ? self.foot : null,
    footCount: self.foot.length,
    melds: self.melds,
    isDown: self.isDown,
    inFoot: self.inFoot,
    opponents,
    discard: state.discard,
    stockCount: state.stock.length,
    currentSeat: state.currentSeat,
    phase: state.phase,
    roundNumber: state.roundNumber,
    // The viewer's own obligation, and only ever theirs: `OpponentView` has no such
    // field, so another seat's is not merely omitted here but unrepresentable.
    pickedUp: self.pickedUp ?? [],
  };
}
