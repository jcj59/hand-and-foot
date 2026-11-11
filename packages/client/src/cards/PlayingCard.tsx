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
import { isWild, type Card } from "@hf/shared";
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
  /**
   * Whether a selected card lifts itself. The hand lifts the card's wrapper
   * instead, so a ring drawn around the card moves with it.
   */
  readonly lift?: boolean;
}

const DIMENSIONS: Readonly<Record<CardSize, { readonly w: number; readonly h: number }>> = {
  // The piles in the middle of the table, which everyone watches.
  large: { w: 84, h: 120 },
  normal: { w: 56, h: 80 },
  // A hand on a phone: whole cards, side by side, without taking the screen.
  medium: { w: 46, h: 66 },
  small: { w: 36, h: 52 },
};

/** Card ink: the suit's red or black, a joker's gold. */
const INK = { red: "#C2353A", black: "#15181B", joker: "#B07A00" } as const;
/** Where the corner index sits and how big it is, in card units (a card is 56×80). */
const INDEX = { x: 6, rank: 17, suit: 13 } as const;

function inkOf(card: Card): string {
  if (card.rank === "JOKER") return INK.joker;
  return isRedCard(card) ? INK.red : INK.black;
}

/** The rank as the corner prints it: a joker is "JK" over its star. */
function cornerRank(card: Card): string {
  return card.rank === "JOKER" ? "JK" : rankLabel(card.rank);
}

/**
 * The rank over the suit, in a card's top-left corner; turned half round, the
 * same in the bottom-right corner of a card big enough to want both.
 */
function CornerIndex({
  card,
  colour,
  flip = false,
}: {
  readonly card: Card;
  readonly colour: string;
  readonly flip?: boolean;
}): React.ReactElement {
  const narrow = cornerRank(card).length > 1;
  return (
    <g transform={flip ? "rotate(180 28 40)" : undefined}>
      <text
        fill={colour}
        x={INDEX.x + (narrow ? 6.5 : 4.5)}
        y={INDEX.x + 13}
        fontSize={narrow ? 14 : INDEX.rank}
        fontWeight="700"
        letterSpacing="-0.5"
        textAnchor="middle"
        fontFamily="'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif"
      >
        {cornerRank(card)}
      </text>
      <text
        fill={colour}
        x={INDEX.x + (narrow ? 6.5 : 4.5)}
        y={INDEX.x + 26}
        fontSize={INDEX.suit}
        textAnchor="middle"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
      >
        {suitSymbol(card.suit)}
      </text>
    </g>
  );
}

/**
 * The face of a card, drawn into a 56×80 viewBox: warm white (a wild warmer still,
 * with a gold inner line, so the cards that play anywhere stand out in a hand),
 * the rank over the suit in the corner, and on a card big enough to read them, a
 * large suit in the middle and the index again upside down.
 */
function CardFace({
  card,
  stroke,
  strokeWidth,
  x = 0,
  y = 0,
  tint,
  full = true,
}: {
  readonly card: Card;
  /** An outline to draw around the card (a book's colour, a selection); a hairline if none. */
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly x?: number;
  readonly y?: number;
  /** Ink to draw the rank and suit in, instead of the suit's own colour. */
  readonly tint?: string;
  /** The middle suit and the second index; off for the small cards of a phone's hand. */
  readonly full?: boolean;
}): React.ReactElement {
  const colour = tint ?? inkOf(card);
  const wild = isWild(card.rank);
  const fill = wild ? "url(#hf-card-wild)" : "url(#hf-card-face)";
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x="0.5"
        y="0.5"
        width="55"
        height="79"
        rx="6"
        fill={fill}
        stroke={stroke ?? "rgba(0,0,0,0.16)"}
        strokeWidth={strokeWidth ?? 1}
      />
      {wild && (
        <rect
          x="2.5"
          y="2.5"
          width="51"
          height="75"
          rx="4.5"
          fill="none"
          stroke="#F2C14E"
          strokeWidth="2"
        />
      )}
      <CornerIndex card={card} colour={colour} />
      {full && (
        <>
          <text
            x="28"
            y="52"
            fontSize="26"
            textAnchor="middle"
            fill={colour}
            fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          >
            {suitSymbol(card.suit)}
          </text>
          <CornerIndex card={card} colour={colour} flip />
        </>
      )}
    </g>
  );
}

/**
 * The gradients every card face fills with, defined once per drawing. Each SVG
 * that draws a face carries them, so a face never depends on another drawing
 * still being on the page; the ids repeat, and every copy says the same thing.
 */
function FaceDefs(): React.ReactElement {
  return (
    <defs>
      <linearGradient id="hf-card-face" x1="0" y1="0" x2="0.55" y2="1">
        <stop offset="0" stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#EFEADF" />
      </linearGradient>
      <linearGradient id="hf-card-wild" x1="0" y1="0" x2="0.55" y2="1">
        <stop offset="0" stopColor="#FFF9E6" />
        <stop offset="1" stopColor="#F8E7B8" />
      </linearGradient>
      <linearGradient id="hf-card-back" x1="0" y1="0" x2="0.55" y2="1">
        <stop offset="0" stopColor="#2BB57A" />
        <stop offset="1" stopColor="#146B45" />
      </linearGradient>
      <pattern id="hf-card-weave" width="7" height="7" patternUnits="userSpaceOnUse">
        <path d="M0 0L7 7M7 0L0 7" stroke="rgba(255,255,255,0.14)" strokeWidth="1.4" />
      </pattern>
    </defs>
  );
}

/** Whether a size draws the whole face, or only the corner (a phone's hand, a chip). */
function fullFace(size: CardSize): boolean {
  return size === "large" || size === "normal";
}

export function PlayingCard({
  card,
  size = "normal",
  selected = false,
  onSelect,
  disabled = false,
  dimmed = isDeadWeight(card),
  lift = true,
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
      <FaceDefs />
      <CardFace
        card={card}
        stroke={selected ? "#F2C14E" : undefined}
        strokeWidth={selected ? 3 : undefined}
        full={fullFace(size)}
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
      className={`rounded transition-transform duration-150 ease-out ${selected && lift ? "-translate-y-3" : ""} ${
        dimmed ? "opacity-60" : ""
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {face}
    </button>
  );
}

/** A card back, for stacks and fans of cards nobody may see. */
function Back({
  x,
  y,
  emblem = true,
}: {
  readonly x: number;
  readonly y: number;
  /** The diamond in the middle; left off the cards fanned behind the front one. */
  readonly emblem?: boolean;
}): React.ReactElement {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x="0.5"
        y="0.5"
        width="55"
        height="79"
        rx="6"
        fill="#F7F5EE"
        stroke="rgba(0,0,0,0.25)"
      />
      <rect x="3.5" y="3.5" width="49" height="73" rx="4" fill="url(#hf-card-back)" />
      <rect x="3.5" y="3.5" width="49" height="73" rx="4" fill="url(#hf-card-weave)" />
      <rect
        x="3.5"
        y="3.5"
        width="49"
        height="73"
        rx="4"
        fill="none"
        stroke="rgba(6,33,21,0.3)"
        strokeWidth="2"
      />
      {emblem && (
        <rect
          x="21"
          y="33"
          width="14"
          height="14"
          rx="2.5"
          transform="rotate(45 28 40)"
          fill="#146B45"
          stroke="rgba(247,245,238,0.85)"
          strokeWidth="2"
        />
      )}
    </g>
  );
}

/**
 * The edges drawn behind a discard pile's two cards: none for a pile of two or
 * fewer, then one more for every `PILE_EDGE_EVERY` cards, up to `PILE_EDGES_MAX`,
 * so a big pile reads as big without the exact count having to be read.
 */
function pileEdges(count: number): number {
  if (count <= 2) return 0;
  return Math.min(PILE_EDGES_MAX, 1 + Math.floor((count - 3) / PILE_EDGE_EVERY));
}
const PILE_EDGE_EVERY = 6;
const PILE_EDGES_MAX = 4;
/** How far each edge sits out from the one in front of it, in card units (a card is 56 wide). */
const PILE_EDGE_STEP = 3;
/** Each edge's tilt, front to back, so the pile looks thrown together rather than squared up. */
const PILE_EDGE_TILT = [3.5, -2.5, 4.5, -1.5] as const;
/** Room to the left for the card beneath, which is tilted and peeks out. */
const PILE_PEEK_X = 22;
const PILE_PEEK_Y = 8;

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
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="2"
          strokeDasharray="5 4"
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
          <FaceDefs />
          <defs>
            <linearGradient id="hf-pile-edge" x1="0" y1="0" x2="0.55" y2="1">
              <stop offset="0" stopColor="#FBF8F0" />
              <stop offset="1" stopColor="#E6E0D0" />
            </linearGradient>
          </defs>
          {Array.from({ length: edges }, (_, i) => {
            const d = (edges - i) * PILE_EDGE_STEP;
            const cx = topX + d + 28;
            const cy = topY + d + 40;
            return (
              <rect
                key={d}
                data-pile-edge=""
                x={topX + 0.5 + d}
                y={topY + 0.5 + d}
                width="55"
                height="79"
                rx="6"
                fill="url(#hf-pile-edge)"
                stroke="rgba(0,0,0,0.2)"
                strokeWidth="1"
                transform={`rotate(${PILE_EDGE_TILT[i] ?? 0} ${cx} ${cy})`}
              />
            );
          })}
          {under && (
            <g transform={`translate(0 ${topY + 5}) rotate(-9 28 40)`}>
              <CardFace card={under} />
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
        <FaceDefs />
        <CardFace card={top} full={fullFace(size)} />
      </svg>
    </div>
  );
}

/** The most cards a face-down stack is drawn as, however many it holds. */
export const STOCK_LAYERS_MAX = 5;

/**
 * How many backs a face-down pile is drawn as: one per fourteen cards, from one,
 * up to `STOCK_LAYERS_MAX`, so a full stock looks deep and a nearly empty one thin.
 * The exact number is written under it; this is only the look.
 */
export function stockLayers(count: number): number {
  if (count <= 0) return 0;
  return Math.min(STOCK_LAYERS_MAX, 1 + Math.floor(count / 14));
}

/**
 * The exact count under a pile, as the design writes it: "Stock 58", "Pile 9", in
 * a dark pill on the felt. Decoration for sighted players; the pile's own
 * accessible name carries the same number.
 */
export function CountPill({
  label,
  count,
}: {
  readonly label: string;
  readonly count: number;
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex items-baseline gap-1.5 rounded-full bg-black/30 px-2.5 py-[3px]"
    >
      <span className="text-[11px] font-medium text-ink/70">{label}</span>
      <span className="font-display text-sm font-bold text-card">{count}</span>
    </span>
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
  const layers = stockLayers(count);
  const offset = 2;
  const pad = offset * (STOCK_LAYERS_MAX - 1);
  return (
    <svg
      width={(width * (56 + pad)) / 56}
      height={(width * (80 + pad)) / 56}
      viewBox={`0 0 ${56 + pad} ${80 + pad}`}
      aria-hidden="true"
      className="block"
    >
      <FaceDefs />
      {count === 0 ? (
        <rect
          x="1"
          y="1"
          width="54"
          height="78"
          rx="5"
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
      ) : (
        Array.from({ length: layers }, (_, i) => layers - 1 - i).map((layer) => (
          <Back key={layer} x={layer * offset} y={layer * offset} emblem={layer === 0} />
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
  pill,
}: {
  readonly count: number;
  readonly label: string;
  readonly size?: CardSize;
  readonly onClick?: () => void;
  /** What clicking does, for the button's name. */
  readonly actionLabel?: string;
  /** Write the count in a pill with this word ("Stock 58"), rather than as a bare number. */
  readonly pill?: string;
}): React.ReactElement {
  const { w } = DIMENSIONS[size];
  // In phase with every other pulse on the table. The glow starts when the pile
  // becomes clickable, not when it first appears, so that is when the phase is set.
  const clickable = onClick !== undefined;
  const pulse = useMemo(() => (clickable ? pulseStyle() : undefined), [clickable]);
  const body = (
    <>
      <Stack count={count} width={w} />
      {pill ? (
        <CountPill label={pill} count={count} />
      ) : (
        <span className="text-xs text-white/70">{count}</span>
      )}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={pulse}
        aria-label={`${actionLabel ?? label} (${count} left)`}
        className="pile-prompt flex flex-col items-center gap-2 rounded-xl p-1 transition hover:bg-white/5"
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className="flex flex-col items-center gap-2 p-1"
      aria-label={`${label}: ${count}`}
      role="img"
    >
      {body}
    </div>
  );
}
