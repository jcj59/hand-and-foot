/**
 * The table's latest moves, kept as they arrive so a bug report can carry
 * them. Kept in a ref, not state: nothing on screen shows them, so a move
 * arriving should not render the table again, and the report reads them only
 * as its sheet opens.
 */
import { useCallback, useEffect, useRef } from "react";
import type { LastMove } from "@hf/shared";
import { withRecord } from "./context";

/** A reader of the last moves this table was sent, forgotten when the table changes. */
export function useMoveRecords(
  roomId: string,
  lastMove: LastMove | undefined,
): () => readonly LastMove[] {
  const kept = useRef<{ roomId: string; moves: readonly LastMove[] }>({ roomId, moves: [] });
  useEffect(() => {
    if (kept.current.roomId !== roomId) kept.current = { roomId, moves: [] };
    if (lastMove) kept.current = { roomId, moves: withRecord(kept.current.moves, lastMove) };
  }, [roomId, lastMove]);
  return useCallback(() => kept.current.moves, []);
}
