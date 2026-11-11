/**
 * The Marva Rule, celebrated: when a player gets down only because the rule waived
 * the minimum — their lay-down emptied the hand — every screen at the table says
 * so, with confetti, a deep voice saying "Marva Rule", and a DJ air horn after it.
 *
 * Whether it happened is the engine's call, carried to every seat on the move
 * itself (`LastMove.marva`), so nothing here judges a lay-down; this only notices
 * a move it has not seen before that says so.
 */
import { useEffect, useRef, useState } from "react";
import type { LastMove } from "@hf/shared";
import { Celebration, CelebrationCard } from "./Celebration";
import { sayDeep } from "./grabby";

/** How long the celebration stays up: long enough for the voice and the horn. */
export const MARVA_MS = 5_000;

export interface MarvaNews {
  readonly seq: number;
  readonly name: string;
}

/**
 * Celebrate a Marva get-down as it arrives. Returns who is being celebrated, or
 * null. Nothing is celebrated for the move the page opened on — that happened
 * before anyone here was watching — nor for one reached `quiet`ly, as a replay
 * seeking past the moment does. Unless muted, the voice says it and then the horn
 * plays; `horn` is how the table plays a sound.
 */
export function useMarvaCelebration(
  move: LastMove | undefined,
  nameOf: (seat: number) => string,
  muted: boolean,
  quiet: boolean,
  horn: () => void,
): MarvaNews | null {
  const [shown, setShown] = useState<MarvaNews | null>(null);
  const seen = useRef<number | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ nameOf, horn });
  latest.current = { nameOf, horn };

  useEffect(() => {
    const previous = seen.current;
    const seq = move?.seq ?? null;
    if (seq === previous) return;
    seen.current = seq;
    if (previous === undefined || !move?.marva || quiet) return;
    setShown({ seq: move.seq, name: latest.current.nameOf(move.seat) });
    if (!muted) sayDeep("Marva Rule", () => latest.current.horn());
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), MARVA_MS);
  }, [move, muted, quiet]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return shown;
}

/** The announcement: the rule's name, large, over a shower of confetti. */
export function MarvaCelebration({ news }: { readonly news: MarvaNews }): React.ReactElement {
  return (
    <Celebration label="Marva Rule" ms={MARVA_MS} confetti>
      <CelebrationCard
        icon="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"
        color="#F59E8B"
        title="Marva Rule"
        headline={`${news.name} got down with the Marva Rule`}
        line={`${news.name}'s first lay-down emptied the hand, so it counts whatever it is worth, minimum or not.`}
      />
    </Celebration>
  );
}
