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
import { isWild, type Card, type Rank } from "@hf/shared";
import { PlayingCard } from "../cards/PlayingCard";
import { isUnplayable, sortForDisplay, type PlayContext } from "../cards/handOrder";

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
  readonly title: string;
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
  meldRanks,
  playContext,
  onSelect,
  chosenId,
  menu,
  title,
  newId = null,
  rows = false,
}: HandProps): React.ReactElement {
  const wildCount = cards.filter((card) => isWild(card.rank)).length;

  if (cards.length === 0) {
    return (
      <section className="flex flex-col gap-2" aria-label={title}>
        <h2 className="text-sm font-medium text-white/80">{title} (0)</h2>
        <p className="text-sm text-white/50">
          No cards. You still take a turn: draw, and play from the pile if it fits.
        </p>
      </section>
    );
  }

  const sorted = sortForDisplay(cards);

  function renderCard(card: Card, position: number, rowLength: number): React.ReactElement {
    const owed = owedIds.has(card.id);
    const melded = !isWild(card.rank) && meldRanks.has(card.rank);
    const lifted = stagedIds.has(card.id) || chosenId === card.id;
    const fresh = card.id === newId;
    return (
      <span
        key={card.id}
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
            owed
              ? "rounded ring-2 ring-sky-300"
              : fresh
                ? "rounded ring-2 ring-sky-300 ring-offset-2 ring-offset-felt-900"
                : undefined
          }
          aria-description={fresh ? "just drawn" : undefined}
        >
          <PlayingCard
            card={card}
            selected={lifted}
            dimmed={isUnplayable(card, playContext)}
            onSelect={interactive ? onSelect : undefined}
          />
        </span>
        <span
          aria-hidden="true"
          className={`h-1 w-8 rounded ${melded ? "bg-emerald-400" : "bg-transparent"}`}
        />
        {chosenId === card.id && menu && (
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
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-sm font-medium text-white/80">
        {title} ({cards.length})
        {/* Wilds are a resource to plan a lay-down around rather than a rank to
            collect, so the count is worth stating next to the total. */}
        {wildCount > 0 && <span className="ml-2 font-normal text-white/50">{wildCount} wild</span>}
      </h2>
      {/* Side by side, never overlapping: every card's whole face is readable. */}
      {rows ? (
        <div className="flex flex-col gap-1 pt-3">
          {evenRows(sorted, perRow(window.innerWidth)).map((row) => (
            <div key={row[0]!.id} className="flex gap-1">
              {row.map((card, i) => renderCard(card, i, row.length))}
            </div>
          ))}
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
 * How many whole cards fit across a screen this wide: a card and its gap are 60
 * pixels, and the table keeps a little margin either side.
 */
export function perRow(width: number): number {
  return Math.max(3, Math.floor((width - 24) / 60));
}

/** The hand as rows of equal length, as few as fit `max` cards a row. */
export function evenRows<T>(cards: readonly T[], max: number): T[][] {
  const count = Math.max(1, Math.ceil(cards.length / max));
  const size = Math.ceil(cards.length / count);
  const rows: T[][] = [];
  for (let i = 0; i < cards.length; i += size) rows.push(cards.slice(i, i + size));
  return rows;
}
