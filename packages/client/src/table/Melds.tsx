/**
 * A player's melds, one row per rank.
 *
 * A meld still being built is fanned out, with its size stated, because six means
 * one more card completes it. A completed book collapses to a single stacked card,
 * red when clean and black when dirty: it is one scoring unit now, and the colour
 * says which bonus it earned. `classifyBook` comes from the engine so the display
 * cannot disagree with what scoring will say.
 *
 * With `onSelect`, a meld can be clicked to aim the player's next cards at it —
 * which is the only way to add a wild to a meld already on the table.
 */
import { type Meld, type Rank, type RulesConfig } from "@hf/shared";
import { classifyBook, meldPoints } from "@hf/engine";
import { BookCard, PlayingCard } from "../cards/PlayingCard";
import { sortForDisplay } from "../cards/handOrder";

export interface MeldsProps {
  readonly melds: readonly Meld[];
  readonly config: RulesConfig;
  /** Smaller rows for an opponent's side of the table. */
  readonly compact?: boolean;
  /** Makes each meld selectable, as the target for the next cards staged. */
  readonly onSelect?: (rank: Rank) => void;
  /** The meld currently selected, drawn highlighted. */
  readonly selectedRank?: Rank | null;
}

export function Melds({
  melds,
  config,
  compact = false,
  onSelect,
  selectedRank = null,
}: MeldsProps): React.ReactElement {
  if (melds.length === 0) {
    return <p className="text-xs text-white/40">Not down yet.</p>;
  }

  return (
    <ul className="flex flex-wrap gap-3">
      {melds.map((meld) => {
        const kind = classifyBook(meld);
        const size = compact ? "small" : "normal";
        const selected = selectedRank === meld.rank;
        const face =
          kind === "incomplete" ? (
            <div className="flex -space-x-4">
              {sortForDisplay(meld.cards).map((card) => (
                <PlayingCard key={card.id} card={card} size={size} />
              ))}
            </div>
          ) : (
            <BookCard rank={meld.rank} kind={kind} count={meld.cards.length} size={size} />
          );
        const caption = (
          <span className="text-xs whitespace-nowrap text-white/60">
            {kind === "incomplete" ? `${meld.cards.length} cards` : `${kind} book`}
            {!compact && ` · ${meldPoints(meld, config)}`}
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
                }`}
              >
                {face}
                {caption}
              </button>
            ) : (
              <div className="flex flex-col items-start gap-1 p-1">
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
