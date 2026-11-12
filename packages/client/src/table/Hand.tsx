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
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isWild, type Card, type Rank } from "@hf/shared";
import { PlayingCard } from "../cards/PlayingCard";
import { menuTitle } from "./CardMenu";
import { placeMenu, type MenuPlace } from "./menuPlacement";
import { canLayOff, isUnplayable, sortForDisplay, type PlayContext } from "../cards/handOrder";

export interface HandProps {
  readonly cards: readonly Card[];
  /** Whether any card may be clicked at all. */
  readonly interactive: boolean;
  /** Cards currently staged into a meld, drawn lifted. */
  readonly stagedIds: ReadonlySet<string>;
  /** Cards taken from the pile that still owe a play. */
  readonly owedIds: ReadonlySet<string>;
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
  /**
   * One row, centered, the cards overlapping just enough to fit the width: a hand
   * being watched on the felt, as the replay player shows it, in cards of this
   * size. Nothing is chosen there, so a card covered but for its corner is enough.
   */
  readonly fan?: "medium" | "normal";
}

export function Hand({
  cards,
  interactive,
  stagedIds,
  owedIds,
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
  fan,
}: HandProps): React.ReactElement {
  const wildCount = cards.filter((card) => isWild(card.rank)).length;
  const hasOwed = cards.some((card) => owedIds.has(card.id));
  const [rowsRef, rowsWidth] = useWidth<HTMLDivElement>();
  const [fanRef, fanWidth] = useWidth<HTMLDivElement>();

  if (cards.length === 0) {
    return (
      <section className="flex flex-col gap-2" aria-label={title} data-zone="hand">
        <h2 className="m-0 flex items-center gap-1 text-xs font-semibold text-nav-ink md:text-[13px]">
          {badge}
          {title}
        </h2>
        <p className="m-0 text-sm text-muted">
          No cards. You still take a turn: draw, and play from the pile if it fits.
        </p>
      </section>
    );
  }

  const sorted = sortForDisplay(cards);
  const fanOverlap = fan ? fanMargin(fanWidth, sorted.length, FAN_CARD_W[fan]) : 0;
  const chosen = rows && menu ? (sorted.find((card) => card.id === chosenId) ?? null) : null;

  function renderCard(card: Card, position: number): React.ReactElement {
    const owed = owedIds.has(card.id);
    const melded = canLayOff(card, meldRanks, playContext);
    const staged = stagedIds.has(card.id);
    const lifted = staged || chosenId === card.id;
    const fresh = card.id === newId;
    return (
      <span
        key={card.id}
        data-motion={card.id}
        className={`relative flex flex-col items-center gap-0.5 ${!rows && !fan && position > 0 ? "-ml-3" : ""}`}
        style={fan && position > 0 ? { marginLeft: fanOverlap } : undefined}
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
          <span className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 rounded bg-blue px-1 text-[10px] font-bold text-[#0B2340]">
            NEW
          </span>
        )}
        <span
          className={`block rounded-md transition-transform duration-150 ease-out ${
            lifted ? (rows ? "-translate-y-[7px]" : "-translate-y-3.5") : ""
          } ${
            owed
              ? "ring-[3px] ring-blue"
              : staged
                ? "ring-[3px] ring-accent"
                : fresh
                  ? "ring-2 ring-blue ring-offset-2 ring-offset-nav"
                  : ""
          }`}
          aria-description={fresh ? "just drawn" : undefined}
        >
          <PlayingCard
            card={card}
            size={fan ?? (rows ? "medium" : "normal")}
            selected={lifted}
            lift={false}
            dimmed={isUnplayable(card, playContext)}
            onSelect={interactive ? onSelect : undefined}
          />
        </span>
        <span
          aria-hidden="true"
          className={`h-1 w-8 rounded ${melded ? "bg-emerald-400" : "bg-transparent"}`}
        />
        {!rows && chosenId === card.id && menu && (
          <CardPopover title={menuTitle(card)}>{menu}</CardPopover>
        )}
      </span>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label={title} data-zone="hand">
      <h2
        className={
          fan
            ? "sr-only"
            : "m-0 flex items-center gap-1 text-xs font-semibold text-nav-ink md:text-[13px]"
        }
      >
        {badge}
        {title}
        {/* Wilds are a resource to plan a lay-down around rather than a rank to
            collect, so the count is worth stating beside the title. */}
        <span className="font-normal text-muted">
          {" "}
          · {cards.length} card{cards.length === 1 ? "" : "s"}
          {wildCount > 0 && `, ${wildCount} wild`}
        </span>
        {hasOwed && (
          <span className="font-normal text-blue">
            {" "}
            · blue ring: the pile card you have to play
          </span>
        )}
      </h2>
      {/* Side by side, never overlapping: every card's whole face is readable. */}
      {fan ? (
        <div ref={fanRef} className="flex justify-center pt-1">
          {sorted.map((card, i) => renderCard(card, i))}
        </div>
      ) : rows ? (
        <div ref={rowsRef} data-rows className="flex flex-col gap-1.5 pt-1.5">
          {evenRows(sorted, perRow(rowsWidth, PHONE_CARD_W)).map((row) => (
            <div key={row[0]!.id} className="flex gap-1">
              {row.map((card, i) => renderCard(card, i))}
            </div>
          ))}
          {/* A sheet over the bottom of the screen rather than a menu above the card:
              the phone's hand scrolls, and a scrolling box clips whatever pokes out
              of it. The card stays lifted, and the sheet names it. */}
          {chosen &&
            createPortal(
              <div
                className="fixed inset-0 z-40 flex items-end bg-[rgba(6,10,12,0.5)] text-ink"
                onClick={onDismiss}
              >
                <section
                  aria-label={`Actions for ${menuTitle(chosen)}`}
                  role="dialog"
                  onClick={(event) => event.stopPropagation()}
                  className="flex w-full flex-col gap-3 rounded-t-3xl border-t border-white/8 bg-surface px-4 pt-3.5 pb-[calc(1.6rem+env(safe-area-inset-bottom,0px))]"
                >
                  <div className="flex items-center gap-3">
                    <PlayingCard card={chosen} size="medium" />
                    <p className="m-0 flex-1 font-display text-base font-semibold">
                      {menuTitle(chosen)}
                    </p>
                  </div>
                  {menu}
                </section>
              </div>,
              document.body,
            )}
        </div>
      ) : (
        <div className="flex flex-wrap pt-4">{sorted.map((card, i) => renderCard(card, i))}</div>
      )}
    </section>
  );
}

/**
 * A card's menu on a computer: above the card it was opened from, placed by
 * `placeMenu` so it never runs off the window, whichever card in whichever row.
 * Portalled to `document.body` and fixed to the window, so no box around the hand
 * can clip it, and placed again when the window scrolls or changes size. Until it
 * has been measured once it is drawn invisibly, so it never flashes in a wrong spot.
 */
function CardPopover({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<MenuPlace | null>(null);
  useLayoutEffect(() => {
    // The card is the element around the anchor: the one that holds the card and its mark.
    const card = anchorRef.current?.parentElement;
    const menu = menuRef.current;
    if (!card || !menu) return;
    const update = () =>
      setPlace(
        placeMenu(
          card.getBoundingClientRect(),
          { width: menu.offsetWidth, height: menu.offsetHeight },
          // The page's own width leaves out a scroll bar; jsdom has none and says 0.
          {
            width: document.documentElement.clientWidth || window.innerWidth,
            height: window.innerHeight,
          },
        ),
      );
    update();
    // The menu's own size changes too: a warning appears, a button's words change.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update());
    observer?.observe(menu);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);
  return (
    <span ref={anchorRef} hidden>
      {createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label={`Actions for ${title}`}
          data-side={place?.side}
          className="fixed z-30 flex w-[280px] max-w-[calc(100vw-16px)] flex-col gap-2.5 rounded-2xl border border-white/12 bg-raised p-3 text-ink shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
          style={
            place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }
          }
        >
          <p className="m-0 font-display text-sm font-semibold">{title}</p>
          {children}
        </div>,
        document.body,
      )}
    </span>
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

/** The widths of the cards a fan is drawn in; see `CardSize`. */
const FAN_CARD_W = { medium: 46, normal: 56 } as const;

/**
 * The left margin of every card after the first in a fan of `count` cards
 * `cardWidth` wide, across `width`: overlapping a little when they all fit, as
 * a hand held in a fan does, more when they do not, but always leaving a
 * corner's worth (a third of the card) showing.
 */
export function fanMargin(width: number, count: number, cardWidth: number): number {
  if (count < 2) return 0;
  const step = Math.min(cardWidth * 0.8, (width - cardWidth) / (count - 1));
  return Math.round(Math.max(step, cardWidth / 3) - cardWidth);
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
