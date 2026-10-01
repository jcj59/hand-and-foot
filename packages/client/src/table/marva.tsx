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
import { Celebration } from "./Celebration";
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
      <div className="flex items-center gap-2 sm:gap-5">
        <PartyHorn className="h-10 w-10 shrink-0 sm:h-20 sm:w-20" />
        <p className="text-4xl font-black tracking-wide whitespace-nowrap text-amber-200 drop-shadow sm:text-6xl">
          Marva Rule
        </p>
        <PartyHorn className="h-10 w-10 shrink-0 -scale-x-100 sm:h-20 sm:w-20" />
      </div>
      <p className="text-lg text-white/85">{news.name} got down by emptying the hand</p>
    </Celebration>
  );
}

/**
 * A party horn being blown, streamers flying from its bell. Drawn, like the
 * Grabby Pants icon, because not every device's font has the emoji.
 */
export function PartyHorn({ className }: { readonly className?: string }): React.ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className={className}>
      {/* The horn: a striped cone from the mouthpiece at lower left to the bell. */}
      <path
        d="M6 54 L36 22 L44 34 Z"
        fill="#f472b6"
        stroke="#1f2937"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M17 43 L26 33 L29 38 Z" fill="#fde68a" />
      <path d="M27 32 L33 26 L36 30 Z" fill="#60a5fa" />
      <ellipse
        cx="40"
        cy="28"
        rx="4.5"
        ry="7.5"
        transform="rotate(-36 40 28)"
        fill="#fcd34d"
        stroke="#1f2937"
        strokeWidth="2"
      />
      <circle cx="6" cy="54" r="3" fill="#1f2937" />
      {/* Streamers and sparks from the bell. */}
      <path
        d="M46 22 q6 -8 2 -14 q-3 -5 4 -6"
        fill="none"
        stroke="#34d399"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M48 30 q8 -2 10 4 q2 6 4 2"
        fill="none"
        stroke="#c084fc"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M44 18 l-2 -7" stroke="#fcd34d" strokeWidth="3" strokeLinecap="round" />
      <path d="M52 26 l7 -3" stroke="#f87171" strokeWidth="3" strokeLinecap="round" />
      <circle cx="58" cy="14" r="2.5" fill="#60a5fa" />
      <circle cx="36" cy="10" r="2" fill="#f472b6" />
    </svg>
  );
}
