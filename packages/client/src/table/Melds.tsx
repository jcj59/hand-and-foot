/**
 * A player's melds: each one still being built fanned as small cards, overlapping
 * so only the corners show, and each finished book squared up into one stack with
 * a red card on top when it is clean and a black one when it is dirty. Under each,
 * its size, its kind once it is a book, and its points ("5 cards · 70",
 * "7 cards · clean · 120"). Folded, each meld is a chip instead ("K ×4 +★"), in
 * the book's color once it is one: gold for clean, silver for dirty.
 *
 * Wilds sit at the end of a fan, gold-faced, so how dirty a meld is reads at a
 * glance. Whether a meld is a book, and of which kind, is the engine's
 * `classifyBook`, through `meldView`, so the display cannot disagree with scoring.
 *
 * With `onSelect`, a meld can be clicked to aim the player's next cards at it,
 * which is the only way to add a wild to a meld already on the table.
 */
import { isWild, type Card, type Meld, type Rank, type RulesConfig } from "@hf/shared";
import { classifyBook } from "@hf/engine";
import { BookCard, PlayingCard } from "../cards/PlayingCard";
import { isRedCard, sortForDisplay } from "../cards/handOrder";
import { meldChip, meldNote, sortMelds, type MeldOrder, type MeldTone } from "./meldView";

export interface MeldsProps {
  readonly melds: readonly Meld[];
  /** The table's rules, which say what each card is worth. */
  readonly config: RulesConfig;
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

const NOTE_COLOR: Record<MeldTone, string> = {
  clean: "text-gold-soft",
  dirty: "text-ink-soft",
  open: "text-ink/65",
};

export function Melds({
  melds,
  config,
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
        const note = meldNote(meld, config);
        const kind = classifyBook(meld);
        const body = (
          <>
            {kind === "incomplete" ? (
              <MeldFan cards={meld.cards} compact={compact} />
            ) : (
              // One element shows the whole book, so it answers for every card in it.
              <span data-motion={meld.cards.map((card) => card.id).join(" ")}>
                <BookCard
                  top={bookTop(meld.cards, kind)}
                  kind={kind}
                  count={meld.cards.length}
                  size="small"
                />
              </span>
            )}
            <span
              className={`text-[11px] font-semibold whitespace-nowrap md:text-xs ${NOTE_COLOR[note.tone]}`}
            >
              {note.text}
              {pencilled && " · this turn"}
            </span>
          </>
        );
        const shape = `flex gap-1.5 rounded-lg p-1 text-left ${
          rows ? "items-center gap-4" : "h-full flex-col items-start justify-between"
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
function MeldFan({
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
function meldLabel(meld: Meld): string {
  const kind = classifyBook(meld);
  const size = `${meld.cards.length} card${meld.cards.length === 1 ? "" : "s"}`;
  return kind === "incomplete"
    ? `Meld of ${meld.rank}s, ${size}`
    : `${kind} book of ${meld.rank}s, ${size}`;
}

/**
 * The card on top of a finished book, as the game is played at a real table: a
 * red natural on a clean book and a black one on a dirty book, so which bonus it
 * earned shows from across the table. A book that has no natural of its color
 * (seven black kings, clean) still shows a natural, and `BookCard` inks it in the
 * book's color, so the top card always reads red or black as it should.
 */
export function bookTop(cards: readonly Card[], kind: "clean" | "dirty"): Card {
  const naturals = sortForDisplay(cards).filter((card) => !isWild(card.rank));
  const wantRed = kind === "clean";
  return naturals.find((card) => isRedCard(card) === wantRed) ?? naturals[0] ?? cards[0]!;
}
