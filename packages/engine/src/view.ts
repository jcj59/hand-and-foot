import { matchTotals } from "./nextRound";
import { isSeated } from "./seats";
import { SPECTATOR_SEAT, type GameState, type OpponentView, type PlayerView } from "@hf/shared";

/**
 * Project the authoritative game state into the filtered view a single player is
 * allowed to see. The viewer's own hand is visible, and their own foot only once
 * picked up. Every other hidden zone (opponents' hands, all feet contents, and the
 * stock) is reduced to a count. Public information is passed through unchanged.
 * This is the anti-cheat boundary: it is the only thing a client should receive.
 */
/** Ids of the seat's cards melded this turn that can still be taken back. */
function playedThisTurn(state: GameState, seat: number): string[] {
  const base = state.turnBase;
  if (!base || base.seat !== seat || state.currentSeat !== seat) return [];
  const before = new Set(base.player.melds.flatMap((meld) => meld.cards.map((card) => card.id)));
  return state.players[seat].melds.flatMap((meld) =>
    meld.cards.filter((card) => !before.has(card.id)).map((card) => card.id),
  );
}

/**
 * The view for someone watching the table rather than playing at it: public
 * information only. Every player still in the match is an opponent, reduced to
 * counts and the melds on the table; there is no hand and no foot, so nothing
 * hidden at a real table can be in it — a spectator sees less than any player,
 * never more. Its seat is `SPECTATOR_SEAT`.
 */
export function spectate(state: GameState): PlayerView {
  return {
    seat: SPECTATOR_SEAT,
    hand: [],
    foot: null,
    footCount: 0,
    melds: [],
    isDown: false,
    inFoot: false,
    opponents: opponentsOf(state, SPECTATOR_SEAT),
    discard: state.discard,
    stockCount: state.stock.length,
    currentSeat: state.currentSeat,
    phase: state.phase,
    roundNumber: state.roundNumber,
    pickedUp: [],
    playedThisTurn: [],
    wentOutSeat: state.wentOutSeat ?? null,
    finalLapRemaining: state.finalLapRemaining ? state.finalLapRemaining : null,
    scoresSoFar: matchTotals({ ...state, roundEnded: false }),
    departed: state.departed ?? [],
  };
}

/** Every player still in the match but `seat`, as a count of their cards and their melds. */
function opponentsOf(state: GameState, seat: number): OpponentView[] {
  return (
    state.players
      .map((player, index) => ({ player, index }))
      // A player who has left the match is not an opponent any more: their seat is
      // dealt nothing, and the round they left after is over.
      .filter(({ index }) => index !== seat && isSeated(state, index))
      .map(({ player, index }) => ({
        seat: index,
        handCount: player.hand.length,
        footCount: player.foot.length,
        melds: player.melds,
        isDown: player.isDown,
        inFoot: player.inFoot,
      }))
  );
}

export function project(state: GameState, seat: number): PlayerView {
  const self = state.players[seat];

  const opponents = opponentsOf(state, seat);

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
    // Also the viewer's own, and only on their own turn: a base kept for another
    // seat says nothing here.
    playedThisTurn: playedThisTurn(state, seat),
    wentOutSeat: state.wentOutSeat ?? null,
    // Zero means the lap is over, which the round having ended already says.
    finalLapRemaining: state.finalLapRemaining ? state.finalLapRemaining : null,
    // The finished rounds only: the one in play is not scored until it ends.
    scoresSoFar: matchTotals({ ...state, roundEnded: false }),
    departed: state.departed ?? [],
  };
}
