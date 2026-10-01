/**
 * The table's big announcements: a panel over the middle of the table that pops
 * in, stays a few seconds, and goes, on every screen at once. Grabby Pants and
 * the Marva Rule use it, and later celebrations (match awards, the tutorial's
 * milestones) are meant to.
 *
 * Purely visual: what triggers one, and what is said or played with it, belongs
 * to whoever shows it. Reduced motion keeps the announcement and drops the
 * movement — the pop, and any confetti.
 */
import type { CSSProperties, ReactNode } from "react";

export interface CelebrationProps {
  /** The accessible name of the announcement: what it is about. */
  readonly label: string;
  /** How long it stays up; the animation is timed to it. */
  readonly ms: number;
  /** Confetti behind the panel. */
  readonly confetti?: boolean;
  readonly children: ReactNode;
}

export function Celebration({
  label,
  ms,
  confetti = false,
  children,
}: CelebrationProps): React.ReactElement {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {confetti && <Confetti />}
      <div
        role="status"
        aria-label={label}
        style={{ "--celebration-ms": `${ms}ms` } as CSSProperties}
        className="celebration-pop absolute inset-x-0 top-1/4 mx-auto flex w-fit max-w-[90vw] flex-col items-center gap-2 rounded-3xl border-2 border-amber-300 bg-felt-900/95 px-5 py-5 sm:px-8 text-center shadow-2xl shadow-black/60"
      >
        {children}
      </div>
    </div>
  );
}

const CONFETTI_COLOURS = ["#fcd34d", "#f472b6", "#60a5fa", "#34d399", "#f87171", "#c084fc"];
export const CONFETTI_PIECES = 80;

/**
 * Where each piece starts and how it falls. Spread by a fixed rule rather than at
 * random, so every screen — and every test — draws the same shower.
 */
export function confettiPieces(count = CONFETTI_PIECES): {
  left: number;
  delay: number;
  fall: number;
  drift: number;
  spin: number;
  colour: string;
  wide: boolean;
}[] {
  return Array.from({ length: count }, (_, i) => {
    // A golden-ratio walk spreads the pieces evenly without lining them up.
    const t = (i * 0.618034) % 1;
    return {
      left: Math.round(t * 1000) / 10,
      delay: (i * 97) % 900,
      fall: 2200 + ((i * 131) % 1100),
      drift: Math.round((((i * 53) % 21) - 10) * 8),
      spin: 360 + ((i * 71) % 4) * 180,
      colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]!,
      wide: i % 3 === 0,
    };
  });
}

function Confetti(): React.ReactElement {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {confettiPieces().map((p, i) => (
        <span
          key={i}
          className={`confetti-piece absolute top-1/4 block rounded-sm ${p.wide ? "h-2 w-3" : "h-3 w-1.5"}`}
          style={
            {
              left: `${p.left}%`,
              backgroundColor: p.colour,
              "--delay": `${p.delay}ms`,
              "--fall-ms": `${p.fall}ms`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
