/**
 * The player's own cards, in display order.
 *
 * Cards are clickable only while there is something a click could mean, and what it
 * means is stated by `mode` rather than inferred: during the play phase a click
 * stages a card towards a meld, and in discard mode it throws one away. Those are
 * very different outcomes to hang off the same gesture, so the mode is explicit and
 * the button labels change with it.
 *
 * Cards still owed to the pile are marked. After taking the discard pile a player
 * must play at least one of the cards they took before the turn can end, and the
 * only way to act on that is to know which cards they are.
 */
import { isWild, type Card } from "@hf/shared";
import { PlayingCard } from "../cards/PlayingCard";
import { sortForDisplay, isDeadWeight } from "../cards/handOrder";

export type HandMode = "idle" | "meld" | "discard";

export interface HandProps {
  readonly cards: readonly Card[];
  readonly mode: HandMode;
  /** Cards currently staged into a meld, drawn lifted. */
  readonly stagedIds: ReadonlySet<string>;
  /** Cards taken from the pile that still owe a play. */
  readonly owedIds: ReadonlySet<string>;
  readonly onSelect: (card: Card) => void;
  readonly title: string;
}

export function Hand({
  cards,
  mode,
  stagedIds,
  owedIds,
  onSelect,
  title,
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

  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h2 className="text-sm font-medium text-white/80">
        {title} ({cards.length})
        {/* Wilds are a resource to plan a lay-down around rather than a rank to
            collect, so the count is worth stating next to the total. */}
        {wildCount > 0 && <span className="ml-2 font-normal text-white/50">{wildCount} wild</span>}
        {mode === "discard" && (
          <span className="ml-2 font-normal text-amber-200">pick a card to discard</span>
        )}
      </h2>
      <div className="flex flex-wrap gap-1">
        {sortForDisplay(cards).map((card) => {
          const owed = owedIds.has(card.id);
          return (
            <span
              key={card.id}
              // A ring rather than a change of the card's own face: the obligation is
              // about where the card came from, not what it is.
              className={owed ? "rounded ring-2 ring-sky-300" : undefined}
              title={owed ? "taken from the pile — owes a play" : undefined}
            >
              <PlayingCard
                card={card}
                selected={stagedIds.has(card.id)}
                // A red three can never be melded, so it is never a staging target.
                // In discard mode it is a perfectly good thing to throw away.
                onSelect={
                  mode === "idle" || (mode === "meld" && isDeadWeight(card)) ? undefined : onSelect
                }
              />
            </span>
          );
        })}
      </div>
    </section>
  );
}
