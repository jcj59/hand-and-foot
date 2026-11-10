/**
 * A small rounded label: a status ("Your turn", "Saved · Fri"), a count, a tag.
 * `tone` picks from the palette; `accent` is the one that says "act on this".
 */
export type ChipTone = "neutral" | "accent" | "gold" | "danger" | "blue" | "violet" | "teal";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-white/8 text-ink-soft",
  accent: "bg-accent text-accent-ink",
  gold: "bg-gold/16 text-gold",
  danger: "bg-danger/16 text-danger-soft",
  blue: "bg-blue/16 text-blue",
  violet: "bg-violet/16 text-violet",
  teal: "bg-teal/16 text-teal",
};

export interface ChipProps {
  readonly tone?: ChipTone;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function Chip({
  tone = "neutral",
  children,
  className = "",
}: ChipProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
