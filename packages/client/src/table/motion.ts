/**
 * Card movement on the table: what should fly where after a move.
 *
 * The approach is FLIP — First, Last, Invert, Play. Every card on screen that can
 * move carries its id (`data-motion`), and the table remembers where each one was.
 * After a move, each card is found where it now is, drawn back at where it was
 * with a transform, and let go, so it slides from the old place to the new. What
 * flies is a copy of the real element, taken the moment it lands, while the real
 * one waits hidden in place — so an animation never disagrees with the table, and
 * no scrolling part of the page can clip a card in flight.
 *
 * A card that is new to the screen — just drawn, just taken with the pile, laid
 * down by another player — has no old place, so it comes from where the move
 * says: the stock, the pile, or that player's seat. Moves that leave no card on
 * this player's screen — another player drawing, or picking up the pile — are
 * drawn as a card back (a "ghost") travelling from the pile to their seat.
 *
 * This file only decides; `useCardMotion` in `cardMotion.ts` does it to the DOM.
 * Movement runs only when a new move arrives, so a re-render, a resize or a
 * collapsed meld never sets cards flying.
 */
import type { LastMove } from "@hf/shared";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where a card is shown: its box, the zone it is in, and whether it can be seen. */
export interface Spot extends Box {
  /** `hand`, `melds`, `pile`, or `seat`: which part of the table shows the card. */
  readonly zone: string;
  /**
   * Whether the card is actually in view — not scrolled out of the middle of the
   * table, say. A card out of view has nowhere visible to fly from or to.
   */
  readonly visible: boolean;
}

/** Slide an element from `from` to where it now is. */
export interface Slide {
  readonly kind: "slide";
  readonly id: string;
  readonly from: Box;
  /** The player's own draw: lifted to the middle of the screen, shown, then put away. */
  readonly reveal: boolean;
}

/** A card back travelling between two places, for a move that leaves no card here. */
export interface Ghost {
  readonly kind: "ghost";
  readonly from: Box;
  readonly to: Box;
  /** How many backs, fanned: one for a draw, a small stack for the pile. */
  readonly cards: number;
}

export type Motion = Slide | Ghost;

/** Moved less than this, a card has only been nudged by the layout: leave it. */
const STILL_PX = 12;

export function planMotion(
  move: LastMove,
  mySeat: number,
  before: ReadonlyMap<string, Spot>,
  after: ReadonlyMap<string, Spot>,
  anchors: ReadonlyMap<string, Box>,
): Motion[] {
  const plans: Motion[] = [];
  const mine = move.seat === mySeat;
  const seat = anchors.get(`seat-${move.seat}`);
  const stock = anchors.get("stock");
  const pile = anchors.get("discard");

  // Where a card that was not on screen before comes from, if anywhere.
  const originOfNew = (id: string): Box | undefined => {
    if (mine && move.kind === "draw" && move.card?.id === id) return stock;
    if (mine && move.kind === "takePile") return pile;
    if (!mine && (move.kind === "discard" || move.kind === "meld")) return seat;
    return undefined;
  };

  for (const [id, now] of after) {
    // A card that lands out of view is not animated: its flight would be drawn
    // over whatever is in view there instead.
    if (!now.visible) continue;
    const was = before.get(id);
    if (was) {
      if (!was.visible) continue;
      // A card that stayed in its zone has only been moved by the layout — a meld
      // that grew, a hand that wrapped — except in the hand, where the cards
      // closing up around one that left is worth seeing.
      if (was.zone === now.zone && now.zone !== "hand") continue;
      if (Math.hypot(was.x - now.x, was.y - now.y) < STILL_PX) continue;
      plans.push({ kind: "slide", id, from: box(was), reveal: false });
      continue;
    }
    const from = originOfNew(id);
    if (from) {
      const reveal = mine && move.kind === "draw" && move.card?.id === id;
      plans.push({ kind: "slide", id, from, reveal });
    }
  }

  // Another player's draw or pickup puts no card on this screen, so a back makes
  // the journey instead: from the stock or the pile, to their seat.
  if (!mine && seat) {
    if (move.kind === "draw" && stock)
      plans.push({ kind: "ghost", from: stock, to: seat, cards: 1 });
    if (move.kind === "takePile" && pile) {
      plans.push({ kind: "ghost", from: pile, to: seat, cards: Math.min(3, move.count ?? 1) });
    }
  }
  return plans;
}

function box(spot: Spot): Box {
  return { x: spot.x, y: spot.y, w: spot.w, h: spot.h };
}
