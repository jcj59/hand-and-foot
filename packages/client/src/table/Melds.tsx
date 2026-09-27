/**
 * A player's melds, one row per rank.
 *
 * A book's size is the thing a player reads off the table — six means one more
 * card completes it, seven means it is closed and worth a bonus — so the count and
 * the kind are stated rather than left to be counted off the cards. `classifyBook`
 * comes from the engine so the label cannot disagree with what scoring will say.
 */
import { type Meld, type RulesConfig } from "@hf/shared";
import { classifyBook, meldPoints } from "@hf/engine";
import { PlayingCard } from "../cards/PlayingCard";
import { sortForDisplay } from "../cards/handOrder";

export interface MeldsProps {
  readonly melds: readonly Meld[];
  readonly config: RulesConfig;
  /** Smaller rows for an opponent's side of the table. */
  readonly compact?: boolean;
}

export function Melds({ melds, config, compact = false }: MeldsProps): React.ReactElement {
  if (melds.length === 0) {
    return <p className="text-xs text-white/40">Not down yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {melds.map((meld) => {
        const kind = classifyBook(meld);
        return (
          <li key={meld.rank} className="flex items-center gap-2" aria-label={meldLabel(meld)}>
            <div className="flex -space-x-4">
              {sortForDisplay(meld.cards).map((card) => (
                <PlayingCard key={card.id} card={card} size={compact ? "small" : "normal"} />
              ))}
            </div>
            <span className="text-xs whitespace-nowrap text-white/60">
              {kind === "incomplete" ? `${meld.cards.length} cards` : `${kind} book`}
              {!compact && ` · ${meldPoints(meld, config)}`}
            </span>
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
