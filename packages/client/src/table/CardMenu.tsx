/**
 * What one card can do right now: meld it (or add it straight to a meld already
 * down), take it back out of a lay-down, discard it. Offered by name rather than
 * one click meaning different things by mode.
 *
 * A discard that looks like a mistake (a wild, a card another player could take
 * the pile with, or one that fits the player's own meld) says why above the
 * buttons, and the button reads "Discard anyway": the player sees the reason
 * before choosing, not after.
 */
import { isWild, type Card, type Rank } from "@hf/shared";
import { cardLabel } from "../cards/cardText";

export interface CardMenuProps {
  readonly card: Card;
  readonly staged: boolean;
  readonly canMeld: boolean;
  /** A melded rank this natural can go straight onto, or null. */
  readonly layOffTo: Rank | null;
  readonly wildTarget: Rank | null;
  readonly canDiscard: boolean;
  readonly discardBlocked: boolean;
  /** Why discarding this card is probably a mistake, if it is. */
  readonly warning: string | null;
  readonly busy: boolean;
  readonly onMeld: () => void;
  readonly onLayOff: () => void;
  readonly onUnstage: () => void;
  readonly onDiscard: () => void;
  readonly onCancel: () => void;
}

const ITEM =
  "flex min-h-12 w-full items-center justify-center rounded-xl px-4 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 md:min-h-10 md:text-sm";
const MINT = `${ITEM} border border-accent/60 bg-accent/8 text-[#BDF5DA] hover:bg-accent/15`;
const DANGER = `${ITEM} border border-salmon/60 bg-salmon/8 text-[#F8C8BC] hover:bg-salmon/15`;
const GHOST = `${ITEM} border border-white/20 text-ink hover:bg-white/5`;

export function CardMenu({
  card,
  staged,
  canMeld,
  layOffTo,
  wildTarget,
  canDiscard,
  discardBlocked,
  warning,
  busy,
  onMeld,
  onLayOff,
  onUnstage,
  onDiscard,
  onCancel,
}: CardMenuProps): React.ReactElement {
  const wild = isWild(card.rank);
  const discarding = canDiscard && !staged;
  return (
    <div className="flex flex-col gap-2.5">
      {discarding && warning && (
        <p className="m-0 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5 text-[13px] leading-[1.45] text-[#F7E3B0] md:text-xs">
          {warning}
        </p>
      )}
      <div role="menu" aria-label="Card actions" className="flex flex-col gap-2 md:gap-1.5">
        {staged ? (
          <button type="button" role="menuitem" onClick={onUnstage} className={MINT}>
            Take back
          </button>
        ) : layOffTo ? (
          <button type="button" role="menuitem" disabled={busy} onClick={onLayOff} className={MINT}>
            Add to {layOffTo}s meld
          </button>
        ) : (
          canMeld && (
            <button
              type="button"
              role="menuitem"
              disabled={wild && wildTarget === null}
              onClick={onMeld}
              className={MINT}
            >
              {wild
                ? wildTarget
                  ? `Add to ${wildTarget}s`
                  : "Select a meld for it first"
                : "Meld"}
            </button>
          )
        )}
        {discarding && (
          <button
            type="button"
            role="menuitem"
            disabled={busy || discardBlocked}
            title={discardBlocked ? "play or take back your staged melds first" : undefined}
            onClick={onDiscard}
            className={DANGER}
          >
            {warning ? "Discard anyway" : "Discard"}
          </button>
        )}
        <button type="button" role="menuitem" onClick={onCancel} className={GHOST}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The card's name for the menu's heading: "King of hearts". */
export function menuTitle(card: Card): string {
  return cardLabel(card).split(",")[0]!;
}
