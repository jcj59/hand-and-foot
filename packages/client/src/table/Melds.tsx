/**
 * A player's melds: each one fanned as small cards, overlapping so only the
 * corners show, with what it still needs written under it ("3 more for a book",
 * "Clean book"). Folded, each meld is a chip instead ("K ×4 +★"), in the book's
 * color once it is one: gold for clean, silver for dirty.
 *
 * Wilds sit at the end of the fan, gold-faced, so how dirty a meld is reads at a
 * glance. Whether a meld is a book, and of which kind, is the engine's
 * `classifyBook`, through `meldView`, so the display cannot disagree with scoring.
 *
 * With `onSelect`, a meld can be clicked to aim the player's next cards at it,
 * which is the only way to add a wild to a meld already on the table.
 */
import type { Card, Meld, Rank } from "@hf/shared";
import { classifyBook } from "@hf/engine";
import { PlayingCard } from "../cards/PlayingCard";
import { sortForDisplay } from "../cards/handOrder";
import { meldChip, meldNote, sortMelds, type MeldOrder, type MeldTone } from "./meldView";

export interface MeldsProps {
  readonly melds: readonly Meld[];
  readonly order?: MeldOrder;
  /** Smaller cards, for another player's box. */
  readonly compact?: boolean;
  /** Makes each meld selectable, as the target for the next cards staged. */
  readonly onSelect?: (rank: Rank) => void;
  /** The meld currently selected, drawn highlighted. */
  readonly selectedRank?: Rank | null;
  /** One chip per meld instead of its cards. */
  readonly chips?: boolean;
  /**
   * Cards played this turn, which can still be taken back. A meld holding any is
   * outlined dashed (pencilled in, not yet inked) until the turn ends.
   */
  readonly provisionalIds?: ReadonlySet<string>;
  /** Each meld beside its note rather than above it, as the other player's sheet lays them. */
  readonly rows?: boolean;
}

const NONE: ReadonlySet<string> = new Set();

export const NOTE_COLOR: Record<MeldTone, string> = {
  clean: "text-gold-soft",
  dirty: "text-ink-soft",
  open: "text-ink/65",
};

export function Melds({
  melds,
  order = "rank",
  compact = false,
  onSelect,
  selectedRank = null,
  chips = false,
  provisionalIds = NONE,
  rows = false,
}: MeldsProps): React.ReactElement {
  const sorted = sortMelds(melds, order);
  if (chips) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {sorted.map((meld) => {
          const kind = classifyBook(meld);
          const selected = selectedRank === meld.rank;
          const pencilled = meld.cards.some((card) => provisionalIds.has(card.id));
          const look =
            kind === "clean"
              ? "bg-gold/30 text-gold-soft"
              : kind === "dirty"
                ? "bg-ink/20 text-ink"
                : "bg-black/30 text-ink";
          const shape = `rounded-[9px] px-2.5 py-1.5 font-display text-[13px] font-bold whitespace-nowrap ${look} ${
            selected ? "ring-2 ring-gold" : ""
          } ${pencilled ? "outline-2 outline-offset-1 outline-sky outline-dashed" : ""}`;
          return (
            <li
              key={meld.rank}
              aria-label={meldLabel(meld)}
              data-motion={meld.cards.map((card) => card.id).join(" ")}
            >
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Select ${meldLabel(meld)}`}
                  onClick={() => onSelect(meld.rank)}
                  className={shape}
                >
                  {meldChip(meld)}
                </button>
              ) : (
                <span className={shape}>{meldChip(meld)}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className={rows ? "flex flex-col gap-3" : "flex flex-wrap gap-x-5 gap-y-3"}>
      {sorted.map((meld) => {
        const selected = selectedRank === meld.rank;
        const pencilled = meld.cards.some((card) => provisionalIds.has(card.id));
        const note = meldNote(meld);
        const body = (
          <>
            <MeldFan cards={meld.cards} compact={compact} />
            <span
              className={`text-[11px] font-semibold whitespace-nowrap md:text-xs ${NOTE_COLOR[note.tone]}`}
            >
              {note.text}
              {pencilled && " · this turn"}
            </span>
          </>
        );
        const shape = `flex gap-1.5 rounded-lg p-1 text-left ${
          rows ? "items-center gap-4" : "flex-col items-start"
        } ${selected ? "ring-2 ring-gold" : ""} ${
          pencilled ? "outline-2 outline-offset-2 outline-sky outline-dashed" : ""
        }`;
        return (
          <li key={meld.rank} aria-label={meldLabel(meld)}>
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selected}
                aria-label={`Select ${meldLabel(meld)}`}
                onClick={() => onSelect(meld.rank)}
                className={`${shape} hover:bg-white/5`}
              >
                {body}
              </button>
            ) : (
              <div className={shape}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One meld's cards, overlapped so only each corner shows, wilds last. */
export function MeldFan({
  cards,
  compact = false,
}: {
  readonly cards: readonly Card[];
  readonly compact?: boolean;
}): React.ReactElement {
  return (
    <span className="flex">
      {sortForDisplay(cards).map((card, i) => (
        <span
          key={card.id}
          data-motion={card.id}
          className={i === 0 ? "" : compact ? "-ml-[22px]" : "-ml-[20px] md:-ml-[18px]"}
        >
          <PlayingCard card={card} size="small" />
        </span>
      ))}
    </span>
  );
}

/**
 * The meld's accessible name. States the rank and the size together, because that
 * pair is the whole meaning of a meld and hearing seven card names is not a
 * substitute for it.
 */
export function meldLabel(meld: Meld): string {
  const kind = classifyBook(meld);
  const size = `${meld.cards.length} card${meld.cards.length === 1 ? "" : "s"}`;
  return kind === "incomplete"
    ? `Meld of ${meld.rank}s, ${size}`
    : `${kind} book of ${meld.rank}s, ${size}`;
}
