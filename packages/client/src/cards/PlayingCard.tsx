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
import { useMemo } from "react";
import type { Card } from "@hf/shared";
import { cardLabel, rankLabel, suitSymbol } from "./cardText";
import { pulseStyle } from "../table/pulse";
import { isDeadWeight, isRedCard } from "./handOrder";

export type CardSize = "large" | "normal" | "medium" | "small";

export interface PlayingCardProps {
  readonly card: Card;
  readonly size?: CardSize;
  /** Lifted and outlined, for a card staged into a meld. */
  readonly selected?: boolean;
  /** Omit to render a plain, non-interactive card. */
  readonly onSelect?: (card: Card) => void;
  readonly disabled?: boolean;
  /**
   * Drawn dimmed, as a card out of play. Defaults to a red three, the one card that
   * never plays anywhere; the player's own cards pass their own answer.
   */
  readonly dimmed?: boolean;
}

const DIMENSIONS: Readonly<Record<CardSize, { readonly w: number; readonly h: number }>> = {
  // The piles in the middle of the table, which everyone watches.
  large: { w: 84, h: 120 },
  normal: { w: 56, h: 80 },
  // A hand on a phone: whole cards, side by side, without taking the screen.
  medium: { w: 46, h: 66 },
  small: { w: 36, h: 52 },
};

/** The face of a card, drawn into a 56×80 viewBox, with the border it is given. */
function CardFace({
  card,
  stroke,
  strokeWidth,
  x = 0,
  y = 0,
  tint,
}: {
  readonly card: Card;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly x?: number;
  readonly y?: number;
  /** Ink to draw the rank and suit in, instead of the suit's own colour. */
  readonly tint?: string;
}): React.ReactElement {
  const colour = tint ?? (isRedCard(card) ? "#dc2626" : "#0f172a");
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x="1"
        y="1"
        width="54"
        height="78"
        rx="5"
        fill="white"
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <text
        x="6"
        y="18"
        fontSize="15"
        fontWeight="700"
        fill={colour}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {rankLabel(card.rank)}
      </text>
      <text x="28" y="54" fontSize="26" textAnchor="middle" fill={colour}>
        {suitSymbol(card.suit)}
      </text>
    </g>
  );
}

export function PlayingCard({
  card,
  size = "normal",
  selected = false,
  onSelect,
  disabled = false,
  dimmed = isDeadWeight(card),
}: PlayingCardProps): React.ReactElement {
  const { w, h } = DIMENSIONS[size];
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
      <CardFace
        card={card}
        stroke={selected ? "#fbbf24" : "#cbd5e1"}
        strokeWidth={selected ? 3 : 1}
      />
    </svg>
  );

  if (!onSelect) {
    return (
      <span
        role="img"
        aria-label={label}
        className={dimmed ? "opacity-60" : undefined}
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
      className={`rounded transition-transform duration-150 ease-out ${selected ? "-translate-y-3" : ""} ${
        dimmed ? "opacity-60" : ""
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {face}
    </button>
  );
}

/**
 * A completed book, collapsed to one card with the rest stacked beneath it.
 *
 * A finished book is a single scoring unit, and seven fanned cards say that far
 * less clearly than one card that is visibly a pile. The top card is drawn like
 * any other, so the table reads the same everywhere; what marks the book is the
 * stack and its border — red for a clean book, black for a dirty one — so which
 * bonus it earned reads at a glance without counting wilds.
 */
export function BookCard({
  top,
  kind,
  count,
  size = "normal",
}: {
  /** The card shown on top: a natural, so the book's rank is what shows. */
  readonly top: Card;
  readonly kind: "clean" | "dirty";
  readonly count: number;
  readonly size?: CardSize;
}): React.ReactElement {
  const { w, h } = DIMENSIONS[size];
  const offset = 3;
  const border = kind === "clean" ? "#dc2626" : "#0f172a";
  return (
    <span role="img" aria-label={`${kind} book of ${rankLabel(top.rank)}s, ${count} cards`}>
      <svg
        width={(w * (56 + offset * 2)) / 56}
        height={(h * (80 + offset * 2)) / 80}
        viewBox={`0 0 ${56 + offset * 2} ${80 + offset * 2}`}
        aria-hidden="true"
        className="block"
      >
        {[2, 1].map((layer) => (
          <rect
            key={layer}
            x={1 + layer * offset}
            y={1 + layer * offset}
            width="54"
            height="78"
            rx="5"
            fill="white"
            stroke={border}
            strokeWidth="2"
          />
        ))}
        {/* The top card is inked in the book's colour too — red for clean, black
            for dirty — so it agrees with its border whatever suit is on top. */}
        <CardFace card={top} stroke={border} strokeWidth={4} tint={border} />
      </svg>
    </span>
  );
}

/** A card back, for stacks and fans of cards nobody may see. */
function Back({ x, y }: { readonly x: number; readonly y: number }): React.ReactElement {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="1" y="1" width="54" height="78" rx="5" fill="#1e3a8a" stroke="#93c5fd" />
      <path d="M8 8 L48 72 M48 8 L8 72" stroke="#3b82f6" strokeWidth="2" />
    </g>
  );
}

/**
 * A hand of cards held face down, fanned so its size reads at a glance. A dozen
 * cards look like a dozen; the exact count is written beside it.
 */
export function HiddenHand({
  count,
  label,
}: {
  readonly count: number;
  readonly label: string;
}): React.ReactElement {
  const shown = Math.min(count, 10);
  const step = 9;
  return (
    <span role="img" aria-label={`${label}: ${count}`} className="flex items-center gap-1">
      {shown > 0 && (
        <svg
          width={(24 * (56 + step * (shown - 1))) / 56}
          height={34}
          viewBox={`0 0 ${56 + step * (shown - 1)} 80`}
          aria-hidden="true"
        >
          {Array.from({ length: shown }, (_, i) => (
            <Back key={i} x={i * step} y={0} />
          ))}
        </svg>
      )}
      <span className="text-xs text-white/70">{count}</span>
    </span>
  );
}

/**
 * The edges drawn behind a discard pile's two cards: none for a pile of two or
 * fewer, then one more for every `PILE_EDGE_EVERY` cards, up to `PILE_EDGES_MAX`,
 * so a big pile reads as big without the exact count having to be read.
 */
export function pileEdges(count: number): number {
  if (count <= 2) return 0;
  return Math.min(PILE_EDGES_MAX, 1 + Math.floor((count - 3) / PILE_EDGE_EVERY));
}
export const PILE_EDGE_EVERY = 6;
export const PILE_EDGES_MAX = 4;
/** How far each edge sits out from the one in front of it, in card units (a card is 56 wide). */
const PILE_EDGE_STEP = 2;
/** Room to the left for the card beneath, which is tilted and peeks out (~7 units as it turns). */
const PILE_PEEK_X = 23;
const PILE_PEEK_Y = 3;

/**
 * The discard pile, face up, drawn as what it is. The top card, and from two cards
 * on the one beneath it peeking out to the left — the whole pile is public, so the
 * second card is as much the players' to see as the first. Behind them, edges down
 * and to the right, more of them the bigger the pile (`pileEdges`).
 *
 * The top card is its own element, carrying `data-motion` with its id, so a card
 * discarded onto the pile flies to exactly where the top card is drawn — not to the
 * whole drawing, which a flight would otherwise copy, beneath card and all.
 */
export function DiscardPile({
  cards,
  size = "normal",
}: {
  readonly cards: readonly Card[];
  readonly size?: CardSize;
}): React.ReactElement {
  const { w } = DIMENSIONS[size];
  const unit = w / 56;
  const top = cards[cards.length - 1];
  if (!top) {
    return (
      <svg
        width={w}
        height={(w * 80) / 56}
        viewBox="0 0 56 80"
        role="img"
        aria-label="Discard pile, empty"
        className="block"
      >
        <rect
          x="1"
          y="1"
          width="54"
          height="78"
          rx="5"
          fill="none"
          stroke="#ffffff40"
          strokeDasharray="4 3"
        />
      </svg>
    );
  }
  const under = cards[cards.length - 2];
  const edges = pileEdges(cards.length);
  const [padX, padY] = under ? [PILE_PEEK_X, PILE_PEEK_Y] : [0, 0];
  const topX = padX;
  const topY = under ? 2 : 0;
  const reach = edges * PILE_EDGE_STEP;
  const width = 56 + padX + reach;
  const height = 80 + padY + reach;
  return (
    <div
      role="img"
      aria-label={`Discard pile, ${cards.length} card${cards.length === 1 ? "" : "s"}, ${cardLabel(top)} on top${under ? `, ${cardLabel(under)} beneath` : ""}`}
      className="relative block"
      style={{ width: width * unit, height: height * unit }}
    >
      {(under || edges > 0) && (
        <svg
          width={width * unit}
          height={height * unit}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          className="absolute inset-0 block"
        >
          {Array.from({ length: edges }, (_, i) => {
            const d = (edges - i) * PILE_EDGE_STEP;
            return (
              <rect
                key={d}
                data-pile-edge=""
                x={topX + 1 + d}
                y={topY + 1 + d}
                width="54"
                height="78"
                rx="5"
                fill="#f8fafc"
                stroke="#94a3b8"
                strokeWidth="1"
              />
            );
          })}
          {under && (
            <g transform={`translate(${topX - 14} ${topY}) rotate(-6 28 80)`}>
              <CardFace card={under} stroke="#cbd5e1" strokeWidth={1} />
            </g>
          )}
        </svg>
      )}
      <svg
        width={w}
        height={(w * 80) / 56}
        viewBox="0 0 56 80"
        aria-hidden="true"
        data-motion={top.id}
        className="absolute block"
        style={{ left: topX * unit, top: topY * unit }}
      >
        <CardFace card={top} stroke="#cbd5e1" strokeWidth={1} />
      </svg>
    </div>
  );
}

/** A face-down pile drawn as a stack, deeper the more it holds. */
function Stack({
  count,
  width,
}: {
  readonly count: number;
  readonly width: number;
}): React.ReactElement {
  const layers = count === 0 ? 0 : Math.min(3, 1 + Math.floor(count / 8));
  const offset = 3;
  const pad = offset * 2;
  return (
    <svg
      width={(width * (56 + pad)) / 56}
      height={(width * (80 + pad)) / 56}
      viewBox={`0 0 ${56 + pad} ${80 + pad}`}
      aria-hidden="true"
      className="block"
    >
      {count === 0 ? (
        <rect
          x="1"
          y="1"
          width="54"
          height="78"
          rx="5"
          fill="none"
          stroke="#ffffff40"
          strokeDasharray="4 3"
        />
      ) : (
        Array.from({ length: layers }, (_, i) => layers - 1 - i).map((layer) => (
          <Back key={layer} x={layer * offset} y={layer * offset} />
        ))
      )}
    </svg>
  );
}

/**
 * The back of a card, for a stock or an unturned foot.
 *
 * Takes a count rather than a card, because that is all the server sends: hidden
 * zones are reduced to a number before they leave it, which is the anti-cheat
 * boundary. There is no card here to draw even if the component wanted one.
 *
 * With `onClick` it is a button — the stock is how a player draws.
 */
export function FaceDownPile({
  count,
  label,
  size = "normal",
  onClick,
  actionLabel,
}: {
  readonly count: number;
  readonly label: string;
  readonly size?: CardSize;
  readonly onClick?: () => void;
  /** What clicking does, for the button's name. */
  readonly actionLabel?: string;
}): React.ReactElement {
  const { w } = DIMENSIONS[size];
  // In phase with every other pulse on the table. The glow starts when the pile
  // becomes clickable, not when it first appears, so that is when the phase is set.
  const clickable = onClick !== undefined;
  const pulse = useMemo(() => (clickable ? pulseStyle() : undefined), [clickable]);
  const body = (
    <>
      <Stack count={count} width={w} />
      <span className="text-xs text-white/70">{count}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={pulse}
        aria-label={`${actionLabel ?? label} (${count} left)`}
        className="pile-prompt flex flex-col items-center gap-1 rounded p-1 ring-2 ring-amber-300 transition hover:bg-white/10"
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className="flex flex-col items-center gap-1 p-1"
      aria-label={`${label}: ${count}`}
      role="img"
    >
      {body}
    </div>
  );
}
