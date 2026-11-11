/**
 * An icon on a tinted rounded square, the way the design marks a tile, a lesson or
 * an award: the icon in a palette color, the square that color at low strength.
 */
import { Icon, type IconName } from "./icons";

export type IconBoxColor =
  "accent" | "gold" | "blue" | "violet" | "teal" | "coral" | "orange" | "lime" | "salmon";

/** Literal class names, so Tailwind's scanner sees every one. */
const COLORS: Record<IconBoxColor, string> = {
  accent: "bg-accent/18 text-accent",
  gold: "bg-gold/18 text-gold",
  blue: "bg-blue/18 text-blue",
  violet: "bg-violet/18 text-violet",
  teal: "bg-teal/18 text-teal",
  coral: "bg-coral/18 text-coral",
  orange: "bg-orange/18 text-orange",
  lime: "bg-lime/18 text-lime",
  salmon: "bg-salmon/18 text-salmon",
};

export interface IconBoxProps {
  readonly icon: IconName;
  readonly color: IconBoxColor;
  /** The square's side in pixels; the icon is a little over half of it. */
  readonly size?: number;
  readonly className?: string;
}

export function IconBox({
  icon,
  color,
  size = 36,
  className = "",
}: IconBoxProps): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-[11px] ${COLORS[color]} ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={Math.round(size * 0.56)} />
    </span>
  );
}
