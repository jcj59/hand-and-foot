/**
 * The lay-down being assembled, and what it is worth.
 *
 * The running total against the round minimum is the reason this panel exists. The
 * minimum is checked across a whole lay-down at once, so a player needs to see the
 * bar fill as they add cards rather than discover after submitting that they were
 * ten short. Everything shown is computed by `previewLayDown`, which mirrors the
 * reducer: it is a preview, and the server still decides.
 *
 * Each meld being built is a box; the one wilds will go to is ringed in gold.
 * Clicking a box aims the next wild at it, and clicking a card in it takes that
 * card back. Playing or abandoning the lay-down is the action bar's, by the hand.
 */
import { useEffect, useRef } from "react";
import type { Card, Rank } from "@hf/shared";
import { isWild } from "@hf/shared";
import { PlayingCard } from "../cards/PlayingCard";
import { usePhone } from "../usePhone";
import type { LayDownPreview, Staging } from "./staging";

export interface StagingPanelProps {
  readonly staging: Staging;
  readonly preview: LayDownPreview;
  readonly zone: readonly Card[];
  readonly isDown: boolean;
  readonly onUnstage: (cardId: string) => void;
  readonly onFocus: (rank: Rank) => void;
}

export function StagingPanel({
  staging,
  preview,
  zone,
  isDown,
  onUnstage,
  onFocus,
}: StagingPanelProps): React.ReactElement {
  const phone = usePhone();
  const click = phone ? "Tap" : "Click";
  // Opened from the hand, below the felt: brought into view, so the bar and the
  // groups it describes are seen as they fill. Not every browser can (jsdom).
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);
  const groups = staging.groups.filter((group) => group.cardIds.length > 0);
  const byId = new Map(zone.map((card) => [card.id, card]));
  const enough = preview.value >= preview.minimum;
  const share = preview.minimum > 0 ? Math.min(100, (preview.value / preview.minimum) * 100) : 100;

  return (
    <section
      ref={panel}
      aria-label="Lay-down being built"
      className="flex flex-col gap-2.5 rounded-2xl border border-gold/45 bg-[#10241C] p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-sm font-semibold">Building a lay-down</h2>
        {/* Only meaningful before getting down; afterwards any legal meld goes. */}
        {!isDown && (
          <p
            className="m-0 text-[13px]"
            aria-label={`Worth ${preview.value} of ${preview.minimum} needed`}
          >
            <span className="font-display text-[15px] font-bold">{preview.value}</span>{" "}
            <span className="text-ink/70">of {preview.minimum} needed</span>
          </p>
        )}
      </div>
      {!isDown && (
        <div aria-hidden="true" className="h-2 rounded bg-black/35">
          <div
            className={`h-2 rounded ${enough ? "bg-accent" : "bg-gold"}`}
            style={{ width: `${share}%` }}
          />
        </div>
      )}

      {groups.length === 0 ? (
        <p className="m-0 text-[13px] text-ink/75">
          {click} cards in your hand to add them. {click} a meld to send wilds to it.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {groups.map((group) => {
            const groupPreview = preview.groups.find((g) => g.rank === group.rank);
            const focused = staging.focusedRank === group.rank;
            const cards = group.cardIds
              .map((id) => byId.get(id))
              .filter((card): card is Card => card !== undefined)
              // Wilds at the end, as every meld on the table shows them.
              .sort((a, b) => Number(isWild(a.rank)) - Number(isWild(b.rank)));
            return (
              <li
                key={group.rank}
                onClick={() => onFocus(group.rank)}
                className={`flex cursor-pointer flex-col gap-1.5 rounded-xl p-2 ${
                  focused ? "bg-gold/12 ring-2 ring-gold" : "bg-black/22"
                }`}
              >
                <span className="flex">
                  {cards.map((card, i) => (
                    <span
                      key={card.id}
                      className={i === 0 ? "" : "-ml-[17px]"}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <PlayingCard card={card} size="small" onSelect={() => onUnstage(card.id)} />
                    </span>
                  ))}
                </span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-ink/80">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onFocus(group.rank);
                    }}
                    aria-pressed={focused}
                    aria-label={`Select the ${group.rank}s meld`}
                  >
                    {group.rank}s
                  </button>
                  {/* Joining a meld already down, the size it will reach says how
                      near the book is. */}
                  {groupPreview && groupPreview.combinedSize > cards.length && (
                    <span className="text-ink/60">· {groupPreview.combinedSize} total</span>
                  )}
                  {focused && <span className="text-gold">· wilds go here</span>}
                  {groupPreview && groupPreview.kind !== "incomplete" && (
                    <span className="text-ink/60">· {groupPreview.kind} book</span>
                  )}
                </span>
                {groupPreview?.problem && (
                  <p className="m-0 max-w-48 text-[11px] text-danger-soft">
                    {groupPreview.problem}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!isDown && groups.length > 0 && (
        <p className={`m-0 text-xs ${enough ? "text-accent" : "text-gold"}`}>
          {enough ? "Enough to get down" : `${preview.minimum - preview.value} more to get down`}
        </p>
      )}

      {preview.marvaWaived && (
        <p className="m-0 text-xs text-accent">
          Below the minimum, but this lay-down empties your hand, which is allowed at this table.
        </p>
      )}

      {preview.emptiesHand && !preview.marvaWaived && (
        <p className="m-0 text-xs text-ink/70">This lay-down empties your hand into your foot.</p>
      )}

      {/* Group problems are already shown against their group; only the lay-down-wide
          ones are repeated here, so nothing is said twice. */}
      {preview.problems
        .filter((problem) => !preview.groups.some((g) => g.problem === problem))
        .map((problem) => (
          <p key={problem} className="m-0 text-xs text-danger-soft">
            {problem}
          </p>
        ))}
    </section>
  );
}
