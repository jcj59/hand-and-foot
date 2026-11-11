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
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[rgba(6,10,12,0.62)]">
      {confetti && <Confetti />}
      <div
        role="status"
        aria-label={label}
        style={
          {
            "--celebration-ms": `${ms}ms`,
            background: "linear-gradient(170deg, #1E2A24, #15191D 70%)",
          } as CSSProperties
        }
        className="celebration-pop relative flex w-[min(86%,440px)] flex-col items-center gap-3 rounded-[28px] border border-gold/50 px-6 py-7 text-center shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        {children}
      </div>
    </div>
  );
}

const CONFETTI_COLOURS = ["#F2C14E", "#4ADE9B", "#E9795B", "#8FB8E8", "#D6A6F0", "#F7F5EE"];
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

/**
 * What every celebration says, laid out the same way: an icon on a tile of its
 * color, the title in gold, who it is about, and a line on what it means.
 */
export function CelebrationCard({
  icon,
  color,
  title,
  headline,
  line,
}: {
  /** An SVG path on a 24-unit grid, stroked. */
  readonly icon: string;
  readonly color: string;
  readonly title: string;
  readonly headline: string;
  readonly line?: string;
}): React.ReactElement {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-[76px] items-center justify-center rounded-[23px]"
        style={{ background: `${color}2E`, color }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icon} />
        </svg>
      </span>
      <p className="m-0 font-display text-[34px] font-bold tracking-[-0.02em] text-gold-soft">
        {title}
      </p>
      <p className="m-0 text-lg font-semibold text-ink">{headline}</p>
      {line && <p className="m-0 text-sm leading-normal text-ink-soft">{line}</p>}
    </>
  );
}
