/**
 * A player's melds, one row per rank.
 *
 * A meld still being built is fanned out, with its size stated, because six means
 * one more card completes it. A completed book collapses to a single card, drawn
 * like any other but stacked and bordered — red when clean, black when dirty: it
 * is one scoring unit now, and the border says which bonus it earned. Every meld
 * states its size underneath. `classifyBook` comes from the engine so the display
 * cannot disagree with what scoring will say.
 *
 * With `onSelect`, a meld can be clicked to aim the player's next cards at it —
 * which is the only way to add a wild to a meld already on the table.
 */
import { isWild, type Card, type Meld, type Rank, type RulesConfig } from "@hf/shared";
import { classifyBook, meldPoints } from "@hf/engine";
import { BookCard, PlayingCard } from "../cards/PlayingCard";
import { isRedCard, sortForDisplay } from "../cards/handOrder";

export interface MeldsProps {
  readonly melds: readonly Meld[];
  readonly config: RulesConfig;
  /** Smaller rows for an opponent's side of the table. */
  readonly compact?: boolean;
  /** Makes each meld selectable, as the target for the next cards staged. */
  readonly onSelect?: (rank: Rank) => void;
  /** The meld currently selected, drawn highlighted. */
  readonly selectedRank?: Rank | null;
  /**
   * One small chip per meld — rank, size, and a clean or dirty border — instead of
   * cards. For a phone, where a row of fanned melds would take the whole screen.
   */
  readonly chips?: boolean;
  /**
   * Cards played this turn, which can still be taken back. A meld holding any is
   * outlined dashed — pencilled in, not yet inked — until the turn ends.
   */
  readonly provisionalIds?: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

export function Melds({
  melds,
  config,
  compact = false,
  onSelect,
  selectedRank = null,
  chips = false,
  provisionalIds = NONE,
}: MeldsProps): React.ReactElement {
  if (melds.length === 0) {
    return <p className="text-xs text-white/40">Not down yet.</p>;
  }
  if (chips) {
    return (
      <MeldChips
        melds={melds}
        onSelect={onSelect}
        selectedRank={selectedRank}
        provisionalIds={provisionalIds}
      />
    );
  }

  return (
    <ul className="flex flex-wrap gap-3">
      {melds.map((meld) => {
        const kind = classifyBook(meld);
        const size = compact ? "small" : "normal";
        const selected = selectedRank === meld.rank;
        const pencilled = meld.cards.some((card) => provisionalIds.has(card.id));
        const face =
          kind === "incomplete" ? (
            <div className="flex -space-x-4">
              {sortForDisplay(meld.cards).map((card) => (
                <span key={card.id} data-motion={card.id}>
                  <PlayingCard card={card} size={size} />
                </span>
              ))}
            </div>
          ) : (
            // One element shows the whole book, so it answers for every card in it.
            <span data-motion={meld.cards.map((card) => card.id).join(" ")}>
              <BookCard
                // A natural on top, so the rank is what shows, of the book's colour
                // where there is one: red for clean, black for dirty.
                top={bookTop(meld.cards, kind)}
                kind={kind}
                count={meld.cards.length}
                size={size}
              />
            </span>
          );
        const caption = (
          <span className="text-xs whitespace-nowrap text-white/60">
            {meld.cards.length} cards{kind === "incomplete" ? "" : ` · ${kind}`}
            {!compact && ` · ${meldPoints(meld, config)}`}
            {pencilled && " · this turn"}
          </span>
        );
        return (
          <li key={meld.rank} aria-label={meldLabel(meld)}>
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selected}
                aria-label={`Select ${meldLabel(meld)}`}
                onClick={() => onSelect(meld.rank)}
                className={`flex flex-col items-start gap-1 rounded p-1 ${
                  selected ? "ring-2 ring-amber-300" : "hover:bg-white/5"
                } ${pencilled ? "outline-2 outline-offset-2 outline-sky-300 outline-dashed" : ""}`}
              >
                {face}
                {caption}
              </button>
            ) : (
              <div
                className={`flex flex-col items-start gap-1 rounded p-1 ${
                  pencilled ? "outline-2 outline-offset-2 outline-sky-300 outline-dashed" : ""
                }`}
              >
                {face}
                {caption}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MeldChips({
  melds,
  onSelect,
  selectedRank,
  provisionalIds = NONE,
}: Pick<MeldsProps, "melds" | "onSelect" | "selectedRank" | "provisionalIds">): React.ReactElement {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {melds.map((meld) => {
        const kind = classifyBook(meld);
        const selected = selectedRank === meld.rank;
        const wilds = meld.cards.filter((card) => isWild(card.rank)).length;
        const look =
          kind === "clean"
            ? "border-red-400 bg-red-500/20"
            : kind === "dirty"
              ? "border-white/70 bg-black/50"
              : "border-white/20 bg-white/5";
        const face = (
          <>
            <span className="text-base font-semibold">{meld.rank}</span>
            <span className="text-xs text-white/70">×{meld.cards.length}</span>
            {wilds > 0 && <span className="text-[10px] text-white/50">{wilds}w</span>}
          </>
        );
        const pencilled = meld.cards.some((card) => provisionalIds.has(card.id));
        const shape = `flex items-baseline gap-1 rounded border px-2 py-0.5 ${look} ${
          selected ? "ring-2 ring-amber-300" : ""
        } ${pencilled ? "border-dashed border-sky-300" : ""}`;
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
                {face}
              </button>
            ) : (
              <span className={shape}>{face}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The row's accessible name. States the rank and the size together, because that
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
 * The card to show on top of a book: a natural, so the rank reads, and one whose
 * suit matches the book's colour when the book has one — a red card on a clean
 * book, a black one on a dirty book.
 */
function bookTop(cards: readonly Card[], kind: "clean" | "dirty"): Card {
  const naturals = sortForDisplay(cards).filter((card) => !isWild(card.rank));
  const wantRed = kind === "clean";
  return naturals.find((card) => isRedCard(card) === wantRed) ?? naturals[0] ?? cards[0]!;
}
