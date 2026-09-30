/**
 * Turning the table's latest move into something a player notices.
 *
 * The server sends the latest move with every view (`ViewUpdate.lastMove`). Left
 * to themselves, players miss most of what others do: a discard changes one card
 * on the pile, a pickup empties it, and neither happens where anyone is looking.
 * So another player's discard or pickup is announced, briefly and with the card,
 * and the player's own draw is marked in their hand until the turn is over.
 *
 * Each move is announced once, by its `seq`: the same move arrives again with
 * every view until the next one, and a reconnect replays the latest.
 */
import { useEffect, useRef, useState } from "react";
import type { Card, LastMove, Rank } from "@hf/shared";

/** How long an announcement stays up. Long enough to read a name and a card. */
export const NEWS_MS = 3_500;

export interface News {
  readonly seq: number;
  readonly text: string;
  readonly card?: Card;
}

const FACE_WORDS: Partial<Record<Rank, string>> = {
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
  JOKER: "Joker",
};

/**
 * A rank as it is said aloud at the table: "a 9", "an 8", "an Ace", "a Joker".
 * Numbers stay digits, as they are printed on the card.
 */
export function aRank(rank: Rank): string {
  const word = FACE_WORDS[rank] ?? rank;
  return `${rank === "8" || rank === "A" ? "an" : "a"} ${word}`;
}

/** What to say about someone else's move, or null for moves not worth a word. */
export function newsFor(move: LastMove, name: string): Omit<News, "seq"> | null {
  switch (move.kind) {
    case "discard":
      return move.card
        ? { text: `${name} discarded ${aRank(move.card.rank)}`, card: move.card }
        : { text: `${name} discarded` };
    case "takePile":
      return {
        text: `${name} picked up the pile (${move.count} card${move.count === 1 ? "" : "s"})`,
      };
    default:
      return null;
  }
}

export interface MoveNews {
  /** The announcement showing now, if any. */
  readonly news: News | null;
  /** The card this player drew this turn, to mark in their hand. */
  readonly drawnId: string | null;
}

export function useMoveNews(
  move: LastMove | undefined,
  mySeat: number | undefined,
  nameOf: (seat: number) => string,
  myTurn: boolean,
): MoveNews {
  const [news, setNews] = useState<News | null>(null);
  const [drawnId, setDrawnId] = useState<string | null>(null);
  const seen = useRef<number | null>(null);
  const name = useRef(nameOf);
  name.current = nameOf;
  // Held outside the effect: the same move arrives again with every view, and an
  // effect cleanup would cancel the timer that is meant to take the news down.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!move || move.seq === seen.current) return;
    // The first move seen is one that happened before this page was here: mark a
    // draw of this player's still in hand, but announce nothing stale.
    const arriving = seen.current !== null;
    seen.current = move.seq;
    if (move.kind === "draw" && move.seat === mySeat && move.card) setDrawnId(move.card.id);
    if (!arriving) return;
    const said = move.seat === mySeat ? null : newsFor(move, name.current(move.seat));
    if (said) {
      setNews({ seq: move.seq, ...said });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNews(null), NEWS_MS);
    }
  }, [move, mySeat]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // The draw stays marked for the rest of the turn, and no longer.
  useEffect(() => {
    if (!myTurn) setDrawnId(null);
  }, [myTurn]);

  return { news, drawnId };
}
