/**
 * The player's own cards, in display order.
 *
 * A card is clickable only while there is something to do with it, and clicking
 * it does not act straight away: it opens a small menu under the card offering
 * what that card can do right now — meld it, discard it, take it back. Melding
 * and discarding are very different outcomes, so the player picks one by name
 * rather than the same click meaning either depending on a mode they set earlier.
 * The menu's contents are the table's decision; this only places it.
 *
 * Two marks help a player read their hand. Cards still owed to the pile are
 * ringed: after taking the discard pile a player must play at least one of them
 * before the turn can end. And cards of a rank the player already has a meld of
 * are underlined, because those can always be laid off and are the ones most
 * worth thinking twice about throwing away.
 */
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isWild, type Card, type Rank } from "@hf/shared";
import { PlayingCard } from "../cards/PlayingCard";
import { cardLabel } from "../cards/cardText";
import { canLayOff, isUnplayable, sortForDisplay, type PlayContext } from "../cards/handOrder";

export interface HandProps {
  readonly cards: readonly Card[];
  /** Whether any card may be clicked at all. */
  readonly interactive: boolean;
  /** Cards currently staged into a meld, drawn lifted. */
  readonly stagedIds: ReadonlySet<string>;
  /** Cards taken from the pile that still owe a play. */
  readonly owedIds: ReadonlySet<string>;
  /** Cards a hint suggests playing, ringed so the suggestion can be found in the hand. */
  readonly hintIds?: ReadonlySet<string>;
  /** Ranks the player already has a meld of on the table. */
  readonly meldRanks: ReadonlySet<Rank>;
  /** Whether black threes can be played from these cards; see `isUnplayable`. */
  readonly playContext: PlayContext;
  readonly onSelect: (card: Card) => void;
  /** The card whose menu is open, and the menu itself. */
  readonly chosenId: string | null;
  readonly menu: React.ReactNode;
  /** Closes the menu; on a phone, a tap anywhere outside its sheet. */
  readonly onDismiss?: () => void;
  readonly title: string;
  /** Shown beside the title, such as the Grabby Pants icon for its holder. */
  readonly badge?: React.ReactNode;
  /** The card just drawn, marked so it is obvious what arrived. */
  readonly newId?: string | null;
  /**
   * Even rows sized to the screen, for a phone: cards never overlap, so a hand too
   * long for one row is split into rows of equal length rather than leaving one
   * card alone on the last.
   */
  readonly rows?: boolean;
}

export function Hand({
  cards,
  interactive,
  stagedIds,
  owedIds,
  hintIds,
  meldRanks,
  playContext,
  onSelect,
  chosenId,
  menu,
  onDismiss,
  title,
  badge,
  newId = null,
  rows = false,
}: HandProps): React.ReactElement {
  const wildCount = cards.filter((card) => isWild(card.rank)).length;
  const [rowsRef, rowsWidth] = useWidth<HTMLDivElement>();

  if (cards.length === 0) {
    return (
      <section className="flex flex-col gap-2" aria-label={title} data-zone="hand">
        <h2 className="flex items-center gap-1 text-sm font-medium text-white/80">
          {badge}
          {title} (0)
        </h2>
        <p className="text-sm text-white/50">
          No cards. You still take a turn: draw, and play from the pile if it fits.
        </p>
      </section>
    );
  }

  const sorted = sortForDisplay(cards);
  const chosen = rows && menu ? (sorted.find((card) => card.id === chosenId) ?? null) : null;

  function renderCard(card: Card, position: number, rowLength: number): React.ReactElement {
    const owed = owedIds.has(card.id);
    const melded = canLayOff(card, meldRanks, playContext);
    const lifted = stagedIds.has(card.id) || chosenId === card.id;
    const fresh = card.id === newId;
    const hinted = hintIds?.has(card.id) ?? false;
    return (
      <span
        key={card.id}
        data-motion={card.id}
        className="relative flex flex-col items-center gap-0.5"
        title={
          owed
            ? "taken from the pile — owes a play"
            : melded
              ? `you have a meld of ${card.rank}s`
              : undefined
        }
      >
        {/* A ring rather than a change of the card's own face: the obligation is
            about where the card came from, not what it is. */}
        {fresh && (
          <span className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 rounded bg-sky-300 px-1 text-[10px] font-bold text-black">
            NEW
          </span>
        )}
        <span
          className={
            hinted
              ? "rounded ring-2 ring-amber-300 ring-offset-2 ring-offset-felt-900"
              : owed
                ? "rounded ring-2 ring-sky-300"
                : fresh
                  ? "rounded ring-2 ring-sky-300 ring-offset-2 ring-offset-felt-900"
                  : undefined
          }
          aria-description={hinted ? "suggested" : fresh ? "just drawn" : undefined}
        >
          <PlayingCard
            card={card}
            size={rows ? "medium" : "normal"}
            selected={lifted}
            dimmed={isUnplayable(card, playContext)}
            onSelect={interactive ? onSelect : undefined}
          />
        </span>
        <span
          aria-hidden="true"
          className={`h-1 w-8 rounded ${melded ? "bg-emerald-400" : "bg-transparent"}`}
        />
        {!rows && chosenId === card.id && menu && (
          // Upward: the hand sits at the bottom of the window.
          <div
            // Opens away from the nearer edge, so a card at either end of its
            // row never has its menu pushed off the screen.
            className={`absolute bottom-full z-20 mb-1 ${
              position < rowLength / 2 ? "left-0" : "right-0"
            }`}
          >
            {menu}
          </div>
        )}
      </span>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label={title} data-zone="hand">
      <h2 className="flex items-center gap-1 text-sm font-medium text-white/80">
        {badge}
        {title} ({cards.length})
        {/* Wilds are a resource to plan a lay-down around rather than a rank to
            collect, so the count is worth stating next to the total. */}
        {wildCount > 0 && <span className="ml-2 font-normal text-white/50">{wildCount} wild</span>}
      </h2>
      {/* Side by side, never overlapping: every card's whole face is readable. */}
      {rows ? (
        <div ref={rowsRef} className="flex flex-col gap-1 pt-3">
          {evenRows(sorted, perRow(rowsWidth, PHONE_CARD_W)).map((row) => (
            <div key={row[0]!.id} className="flex gap-1">
              {row.map((card, i) => renderCard(card, i, row.length))}
            </div>
          ))}
          {/* A sheet over the bottom of the screen rather than a menu above the card:
              the phone's hand scrolls, and a scrolling box clips whatever pokes out
              of it. The card stays lifted, and the sheet names it. */}
          {chosen &&
            createPortal(
              <div
                className="fixed inset-0 z-40 flex items-end bg-black/30 text-white"
                onClick={onDismiss}
              >
                <div
                  aria-label={`Actions for ${cardLabel(chosen)}`}
                  role="group"
                  onClick={(event) => event.stopPropagation()}
                  className="flex w-full flex-col items-center gap-2 rounded-t-xl border-t border-white/15 bg-felt-900 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
                >
                  <p className="text-sm text-white/70">{cardLabel(chosen)}</p>
                  {menu}
                </div>
              </div>,
              document.body,
            )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 pt-3">
          {sorted.map((card, i) => renderCard(card, i, sorted.length))}
        </div>
      )}
    </section>
  );
}

/**
 * The width an element is actually given, kept current as it changes: the hand
 * shares its line with the foot pile and the table's padding, and a phone can
 * turn sideways, so the window's width says neither how much room there is nor
 * when it changed. Without `ResizeObserver` (jsdom) it is the window's width.
 */
function useWidth<T extends HTMLElement>(): [(element: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

/** The width of a card in a phone's hand; see `CardSize`. */
const PHONE_CARD_W = 46;

/**
 * How many whole cards `cardWidth` wide fit across the hand's own width, which
 * is measured inside the table's margins: n cards take n card widths plus a
 * 4-pixel gap between each.
 */
export function perRow(width: number, cardWidth = 56): number {
  return Math.max(3, Math.floor((width + 4) / (cardWidth + 4)));
}

/** The hand as rows of equal length, as few as fit `max` cards a row. */
export function evenRows<T>(cards: readonly T[], max: number): T[][] {
  const count = Math.max(1, Math.ceil(cards.length / max));
  const size = Math.ceil(cards.length / count);
  const rows: T[][] = [];
  for (let i = 0; i < cards.length; i += size) rows.push(cards.slice(i, i + size));
  return rows;
}
