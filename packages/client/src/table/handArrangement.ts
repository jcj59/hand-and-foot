/**
 * The player's own arrangement of their cards: where it is kept, and where a
 * dragged card would land.
 *
 * Purely the player's: the server never hears of it, and every other screen
 * keeps sorting the hand its own way. It is kept in this tab's session storage,
 * one entry per table and seat (`hf.handOrder:<roomId>:<seat>`), so a reload
 * keeps it, and stamped with the round and the zone (hand or foot) it was made
 * for: a new deal, or picking up the foot, is a different set of cards, so an
 * arrangement from before reads as none and the cards are sorted again. Storage
 * that is blocked or full only means the arrangement lasts as long as the page.
 */
import { useCallback, useEffect, useState } from "react";
import type { Card } from "@hf/shared";
import { arrange } from "../cards/handOrder";

const KEY_PREFIX = "hf.handOrder:";

/** Which cards an arrangement was made for. */
export interface HandOrderScope {
  readonly roomId: string;
  readonly seat: number;
  readonly round: number;
  readonly zone: "hand" | "foot";
}

export function handOrderKey(scope: Pick<HandOrderScope, "roomId" | "seat">): string {
  return `${KEY_PREFIX}${scope.roomId}:${scope.seat}`;
}

/** The arrangement kept for `scope`, or null: none, unreadable, or from another round or zone. */
export function readHandOrder(scope: HandOrderScope): string[] | null {
  try {
    const raw = window.sessionStorage.getItem(handOrderKey(scope));
    if (raw === null) return null;
    const kept = JSON.parse(raw) as { round?: unknown; zone?: unknown; ids?: unknown };
    if (kept.round !== scope.round || kept.zone !== scope.zone) return null;
    const ids = kept.ids;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
    return ids;
  } catch {
    return null;
  }
}

/** Keep `ids` for `scope`, or forget the arrangement when `ids` is null. */
export function writeHandOrder(scope: HandOrderScope, ids: readonly string[] | null): void {
  try {
    const key = handOrderKey(scope);
    if (ids === null) window.sessionStorage.removeItem(key);
    else {
      const { round, zone } = scope;
      window.sessionStorage.setItem(key, JSON.stringify({ round, zone, ids }));
    }
  } catch {
    // Blocked or full storage: the arrangement still lasts as long as the page.
  }
}

interface Held {
  readonly id: string | null;
  readonly ids: readonly string[] | null;
}

/**
 * The arrangement for the cards in `scope`, and a way to change it (null puts
 * the default order back). Null `scope` (a hand only being watched) has none.
 *
 * Once there is one, each change to the cards writes it out again as shown, so
 * cards that arrived since keep the places they arrived in: the next card drawn
 * goes to the right of them rather than being sorted in among them.
 */
export function useHandOrder(
  scope: HandOrderScope | null,
  cards: readonly Card[],
): readonly [readonly string[] | null, (ids: readonly string[] | null) => void] {
  // Everything the scope says, as one string: what decides which arrangement applies.
  const id = scope && JSON.stringify([scope.roomId, scope.seat, scope.round, scope.zone]);
  const [held, setHeld] = useState<Held>(() => ({ id, ids: scope && readHandOrder(scope) }));
  // Another round, zone or table: what is kept for it, if anything.
  let current = held;
  if (held.id !== id) {
    current = { id, ids: scope && readHandOrder(scope) };
    setHeld(current);
  }

  const set = useCallback(
    (ids: readonly string[] | null) => {
      if (id === null) return;
      const [roomId, seat, round, zone] = JSON.parse(id) as [string, number, number, "hand"];
      writeHandOrder({ roomId, seat, round, zone }, ids);
      setHeld({ id, ids });
    },
    [id],
  );

  const order = current.ids;
  useEffect(() => {
    if (order === null) return;
    const shown = arrange(cards, order).map((card) => card.id);
    if (shown.length !== order.length || shown.some((cardId, i) => cardId !== order[i])) {
      set(shown);
    }
  }, [cards, order, set]);

  return [order, set] as const;
}

/** A card's place on screen, relative to the hand. */
export interface Slot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where a dragged card would go: before the card at `index`, drawn as a line at `x`. */
export interface Drop {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly h: number;
}

/**
 * Where a card dragged to `point` would land among `slots` (every card, in the
 * order shown, the dragged one too, measured relative to the same corner as the
 * point). The hand may be in rows (a phone's, or a computer's wrapping one), so
 * the row comes first: the one the point is over, else the nearest. Within the
 * row, the card lands before the first card whose middle is right of the point,
 * or after the row's last card. Null for no cards.
 */
export function dropAt(slots: readonly Slot[], point: { x: number; y: number }): Drop | null {
  if (slots.length === 0) return null;
  // Rows: a slot starting below the middle of the one before it begins a new row.
  const rows: number[][] = [];
  slots.forEach((slot, i) => {
    const last = rows[rows.length - 1];
    const prev = slots[i - 1];
    if (last && prev && slot.y < prev.y + prev.h / 2) last.push(i);
    else rows.push([i]);
  });
  const distance = (row: readonly number[]): number => {
    const { y, h } = slots[row[0]!]!;
    return point.y < y ? y - point.y : point.y > y + h ? point.y - (y + h) : 0;
  };
  let row = rows[0]!;
  for (const candidate of rows) if (distance(candidate) < distance(row)) row = candidate;
  const { y, h } = slots[row[0]!]!;
  for (const i of row) {
    const slot = slots[i]!;
    if (point.x < slot.x + slot.w / 2) return { index: i, x: slot.x, y, h };
  }
  const end = slots[row[row.length - 1]!]!;
  return { index: row[row.length - 1]! + 1, x: end.x + end.w, y, h };
}
