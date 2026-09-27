/**
 * One card, drawn as SVG.
 *
 * SVG rather than images so a card scales to any seat size without assets to load,
 * and so the rank and suit are real text a screen reader and a test can read.
 *
 * A card is a `button` only when something can be done with it. Rendering an
 * always-clickable element and ignoring the click would tell a player the card is
 * theirs to move when it is not, and would put every opponent's meld in the tab
 * order for no reason.
 */
import type { Card } from "@hf/shared";
import { cardLabel, rankLabel, suitSymbol } from "./cardText";
import { isDeadWeight, isRedCard } from "./handOrder";

export type CardSize = "normal" | "small";

export interface PlayingCardProps {
  readonly card: Card;
  readonly size?: CardSize;
  /** Lifted and outlined, for a card staged into a meld. */
  readonly selected?: boolean;
  /** Omit to render a plain, non-interactive card. */
  readonly onSelect?: (card: Card) => void;
  readonly disabled?: boolean;
}

const DIMENSIONS: Readonly<Record<CardSize, { readonly w: number; readonly h: number }>> = {
  normal: { w: 56, h: 80 },
  small: { w: 36, h: 52 },
};

export function PlayingCard({
  card,
  size = "normal",
  selected = false,
  onSelect,
  disabled = false,
}: PlayingCardProps): React.ReactElement {
  const { w, h } = DIMENSIONS[size];
  const red = isRedCard(card);
  const label = cardLabel(card);

  const face = (
    <svg
      width={w}
      height={h}
      viewBox="0 0 56 80"
      // The label lives on the wrapper instead, so it is announced once rather than
      // twice, and the drawing itself is decoration.
      aria-hidden="true"
      className="block"
    >
      <rect
        x="1"
        y="1"
        width="54"
        height="78"
        rx="5"
        fill="white"
        stroke={selected ? "#fbbf24" : "#cbd5e1"}
        strokeWidth={selected ? 3 : 1}
      />
      <text
        x="6"
        y="18"
        fontSize="15"
        fontWeight="700"
        fill={red ? "#dc2626" : "#0f172a"}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {rankLabel(card.rank)}
      </text>
      <text x="28" y="54" fontSize="26" textAnchor="middle" fill={red ? "#dc2626" : "#0f172a"}>
        {suitSymbol(card.suit)}
      </text>
    </svg>
  );

  if (!onSelect) {
    return (
      <span
        role="img"
        aria-label={label}
        className={isDeadWeight(card) ? "opacity-60" : undefined}
        data-card-id={card.id}
      >
        {face}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      data-card-id={card.id}
      onClick={() => onSelect(card)}
      className={`rounded transition-transform ${selected ? "-translate-y-2" : ""} ${
        isDeadWeight(card) ? "opacity-60" : ""
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {face}
    </button>
  );
}

/**
 * The back of a card, for a stock or an unturned foot.
 *
 * Takes a count rather than a card, because that is all the server sends: hidden
 * zones are reduced to a number before they leave it, which is the anti-cheat
 * boundary. There is no card here to draw even if the component wanted one.
 */
export function FaceDownPile({
  count,
  label,
  size = "normal",
}: {
  readonly count: number;
  readonly label: string;
  readonly size?: CardSize;
}): React.ReactElement {
  const { w, h } = DIMENSIONS[size];
  return (
    <div className="flex flex-col items-center gap-1" aria-label={`${label}: ${count}`} role="img">
      <svg width={w} height={h} viewBox="0 0 56 80" aria-hidden="true" className="block">
        <rect x="1" y="1" width="54" height="78" rx="5" fill="#1e3a8a" stroke="#93c5fd" />
        <path d="M8 8 L48 72 M48 8 L8 72" stroke="#3b82f6" strokeWidth="2" />
      </svg>
      <span className="text-xs text-white/70">{count}</span>
    </div>
  );
}
