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
import { cardLabel } from "../cards/cardText";
import {
  arrange,
  canLayOff,
  isUnplayable,
  moveBy,
  moveTo,
  sortForDisplay,
  type PlayContext,
} from "../cards/handOrder";
import { dropAt, type Drop, type Slot } from "./handArrangement";

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
  /** The region's name, such as "Your hand"; also its heading unless `owner` is given. */
  readonly title: string;
  /**
   * Whose cards these are, drawn in the heading in place of the title: at the table,
   * the holder's face and name and whether this is their hand or foot. The count
   * follows it as it follows the title.
   */
  readonly owner?: React.ReactNode;
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
  /**
   * The player's own arrangement (card ids, left to right; see `arrange`), or null
   * for the usual order.
   */
  readonly order?: readonly string[] | null;
  /**
   * Rearranges the cards: given the new order, or null to sort them again. Absent
   * where the cards are not the viewer's to arrange (a hand being watched or
   * replayed), and ignored on a `fan`.
   */
  readonly onArrange?: (ids: readonly string[] | null) => void;
}

/**
 * How far a card must be pulled, in pixels, before it is being dragged. Less is a
 * click (which opens the card's menu) with a hand that shook.
 */
export const DRAG_START_PX = 6;

/** A card being pulled: before `DRAG_START_PX` it is only pressed. */
interface Pull {
  readonly id: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  /** Where on the card it was taken hold of. */
  readonly grabX: number;
  readonly grabY: number;
  /** Every card's place when the drag began, relative to the hand, in the order shown. */
  slots: readonly Slot[] | null;
}

/** What a drag in progress draws: the card under the pointer and where it would land. */
interface Dragging {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly drop: Drop | null;
}

/**
 * Sticky, so a hand scrolled inside a short footer still says whose it is. Its own
 * background covers the cards scrolling under it.
 */
const HEADING =
  "sticky top-0 z-[5] m-0 flex min-w-0 items-center gap-1 bg-nav text-xs font-semibold text-nav-ink md:text-[13px]";

/** The heading inside the sticky row that also holds Sort, which is no part of its name. */
const HEADING_TEXT = "m-0 flex min-w-0 items-center gap-1 text-xs font-semibold md:text-[13px]";

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
  owner,
  newId = null,
  rows = false,
  fan,
  order = null,
  onArrange,
}: HandProps): React.ReactElement {
  const wildCount = cards.filter((card) => isWild(card.rank)).length;
  const hasOwed = cards.some((card) => owedIds.has(card.id));
  const [rowsRef, rowsWidth] = useWidth<HTMLDivElement>();
  const [fanRef, fanWidth] = useWidth<HTMLDivElement>();
  const sectionRef = useRef<HTMLElement>(null);
  const pull = useRef<Pull | null>(null);
  // The click that ends a drag must not open the card's menu as well.
  const swallowClick = useRef(false);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [said, setSaid] = useState("");
  // A card moved with the keyboard is drawn anew in its new place: keep it focused.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    sectionRef.current?.querySelector<HTMLElement>(`[data-slot="${id}"] [data-card-id]`)?.focus();
  });

  if (cards.length === 0) {
    return (
      <section className="flex flex-col gap-2" aria-label={title} data-zone="hand">
        <h2 className={HEADING}>{owner ?? title}</h2>
        <p className="m-0 text-sm text-muted">
          No cards. You still take a turn: draw, and play from the pile if it fits.
        </p>
      </section>
    );
  }

  const arrangeable = onArrange !== undefined && !fan;
  const shown = arrange(cards, arrangeable ? order : null);
  const ids = shown.map((card) => card.id);
  const usual = sortForDisplay(cards);
  const rearranged = arrangeable && usual.some((card, i) => card.id !== ids[i]);
  const fanOverlap = fan ? fanMargin(fanWidth, shown.length, FAN_CARD_W[fan]) : 0;
  const chosen = rows && menu ? (shown.find((card) => card.id === chosenId) ?? null) : null;
  const draggedCard = dragging && shown.find((card) => card.id === dragging.id);

  /** Where the pointer is, relative to the hand, as the slots are measured. */
  function within(event: React.PointerEvent): { x: number; y: number } {
    const at = sectionRef.current!.getBoundingClientRect();
    return { x: event.clientX - at.left, y: event.clientY - at.top };
  }

  /** A drop that changes nothing (back where it came from) draws no line. */
  function changes(id: string, drop: Drop | null): drop is Drop {
    const from = ids.indexOf(id);
    return drop !== null && drop.index !== from && drop.index !== from + 1;
  }

  function ownEvent(event: React.SyntheticEvent<HTMLElement>): boolean {
    return event.currentTarget.contains(event.target as Node);
  }

  function onPointerDown(event: React.PointerEvent<HTMLElement>, card: Card): void {
    if (!arrangeable || event.button !== 0) return;
    const at = event.currentTarget.getBoundingClientRect();
    swallowClick.current = false;
    pull.current = {
      id: card.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX: event.clientX - at.left,
      grabY: event.clientY - at.top,
      slots: null,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>): void {
    const held = pull.current;
    if (!held || held.pointerId !== event.pointerId) return;
    if (held.slots === null) {
      const moved = Math.hypot(event.clientX - held.startX, event.clientY - held.startY);
      if (moved <= DRAG_START_PX) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const at = sectionRef.current!.getBoundingClientRect();
      held.slots = [...sectionRef.current!.querySelectorAll<HTMLElement>("[data-slot]")].map(
        (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left - at.left, y: r.top - at.top, w: r.width, h: r.height };
        },
      );
      onDismiss?.();
    }
    const drop = dropAt(held.slots, within(event));
    setDragging({
      id: held.id,
      left: event.clientX - held.grabX,
      top: event.clientY - held.grabY,
      drop: changes(held.id, drop) ? drop : null,
    });
  }

  function onPointerUp(event: React.PointerEvent<HTMLElement>): void {
    const held = pull.current;
    if (!held || held.pointerId !== event.pointerId) return;
    pull.current = null;
    if (held.slots === null) return;
    swallowClick.current = true;
    setDragging(null);
    const drop = dropAt(held.slots, within(event));
    if (changes(held.id, drop)) {
      const next = moveTo(ids, held.id, drop.index);
      onArrange?.(next);
      const card = shown.find((c) => c.id === held.id)!;
      setSaid(`${cardLabel(card)} moved to place ${next.indexOf(held.id) + 1} of ${next.length}`);
    }
  }

  function onPointerCancel(): void {
    pull.current = null;
    setDragging(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>, card: Card): void {
    if (!arrangeable || !event.altKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = moveBy(ids, card.id, event.key === "ArrowLeft" ? -1 : 1);
    const place = next.indexOf(card.id);
    if (place === ids.indexOf(card.id)) {
      setSaid(`${cardLabel(card)} is already ${place === 0 ? "first" : "last"}`);
      return;
    }
    refocus.current = card.id;
    onArrange?.(next);
    setSaid(`${cardLabel(card)} moved to place ${place + 1} of ${next.length}`);
  }

  function renderCard(card: Card, position: number): React.ReactElement {
    const owed = owedIds.has(card.id);
    const melded = canLayOff(card, meldRanks, playContext);
    const staged = stagedIds.has(card.id);
    const lifted = staged || chosenId === card.id;
    const fresh = card.id === newId;
    const held = dragging?.id === card.id;
    return (
      <span
        key={card.id}
        data-motion={card.id}
        data-slot={arrangeable ? card.id : undefined}
        className={`relative flex flex-col items-center gap-0.5 ${!rows && !fan && position > 0 ? "-ml-3" : ""} ${
          arrangeable ? "touch-pan-y select-none" : ""
        } ${held ? "opacity-40" : ""}`}
        style={fan && position > 0 ? { marginLeft: fanOverlap } : undefined}
        onPointerDown={
          arrangeable ? (event) => ownEvent(event) && onPointerDown(event, card) : undefined
        }
        onPointerMove={arrangeable ? (event) => ownEvent(event) && onPointerMove(event) : undefined}
        onPointerUp={arrangeable ? (event) => ownEvent(event) && onPointerUp(event) : undefined}
        onPointerCancel={arrangeable ? onPointerCancel : undefined}
        onKeyDown={arrangeable ? (event) => ownEvent(event) && onKeyDown(event, card) : undefined}
        onClickCapture={
          arrangeable
            ? (event) => {
                if (!ownEvent(event) || !swallowClick.current) return;
                swallowClick.current = false;
                event.preventDefault();
                event.stopPropagation();
              }
            : undefined
        }
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
          // Under the sticky heading (z-5) when the hand scrolls beneath it.
          <span className="absolute -top-2.5 left-1/2 z-[4] -translate-x-1/2 rounded bg-blue px-1 text-[10px] font-bold text-[#0B2340]">
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
            // Out of turn the card is not a button, yet still the player's to move.
            focusable={arrangeable}
            keyShortcuts={arrangeable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
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
    <section
      ref={sectionRef}
      className="relative flex flex-col gap-2"
      aria-label={title}
      data-zone="hand"
    >
      <div className={fan ? "sr-only" : HEADING}>
        <h2 className={HEADING_TEXT}>
          {owner ?? title}
          {/* Wilds are a resource to plan a lay-down around rather than a rank to
            collect, so the count is worth stating beside the title. */}
          <span className="font-normal whitespace-nowrap text-muted">
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
        {rearranged && (
          // Drawn into the heading's own height, so the cards do not shift when it appears.
          <button
            type="button"
            onClick={() => {
              onArrange?.(null);
              setSaid("Cards sorted");
            }}
            title="Put the cards back in the usual order"
            className="-my-1 ml-1.5 min-h-7 shrink-0 rounded-[7px] bg-white/12 px-2.5 text-[11px] font-semibold text-ink hover:bg-white/18 md:my-0 md:text-xs"
          >
            Sort
          </button>
        )}
      </div>
      {arrangeable && (
        <p className="sr-only" aria-live="polite">
          {said}
        </p>
      )}
      {dragging?.drop && (
        <span
          aria-hidden="true"
          data-drop
          className="pointer-events-none absolute z-[6] w-1 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"
          // A little taller than the cards, so it shows between two that overlap.
          style={{ left: dragging.drop.x, top: dragging.drop.y - 6, height: dragging.drop.h + 12 }}
        />
      )}
      {dragging &&
        draggedCard &&
        createPortal(
          <div
            aria-hidden="true"
            data-dragging
            className="pointer-events-none fixed z-50 rotate-3 rounded-md shadow-[0_14px_30px_rgba(0,0,0,0.55)]"
            style={{ left: dragging.left, top: dragging.top }}
          >
            <PlayingCard card={draggedCard} size={rows ? "medium" : "normal"} lift={false} />
          </div>,
          document.body,
        )}
      {/* Side by side, never overlapping: every card's whole face is readable. */}
      {fan ? (
        <div ref={fanRef} className="flex justify-center pt-1">
          {shown.map((card, i) => renderCard(card, i))}
        </div>
      ) : rows ? (
        <div ref={rowsRef} data-rows className="flex flex-col gap-1.5 pt-1.5">
          {evenRows(shown, perRow(rowsWidth, PHONE_CARD_W)).map((row) => (
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
        <div className="flex flex-wrap pt-4">{shown.map((card, i) => renderCard(card, i))}</div>
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
