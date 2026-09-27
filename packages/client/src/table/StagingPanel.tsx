/**
 * The lay-down being assembled, and what it is worth.
 *
 * The running total against the round minimum is the reason this panel exists. The
 * minimum is checked across a whole lay-down at once, so a player needs to see the
 * total climb as they add cards rather than discover after submitting that they were
 * ten short. Everything shown is computed by `previewLayDown`, which mirrors the
 * reducer — it is a preview, and the server still decides.
 */
import type { Card, Rank } from "@hf/shared";
import { PlayingCard } from "../cards/PlayingCard";
import type { LayDownPreview, Staging } from "./staging";

export interface StagingPanelProps {
  readonly staging: Staging;
  readonly preview: LayDownPreview;
  readonly zone: readonly Card[];
  readonly isDown: boolean;
  readonly busy: boolean;
  readonly onUnstage: (cardId: string) => void;
  readonly onFocus: (rank: Rank) => void;
  readonly onCommit: () => void;
  readonly onClear: () => void;
}

export function StagingPanel({
  staging,
  preview,
  zone,
  isDown,
  busy,
  onUnstage,
  onFocus,
  onCommit,
  onClear,
}: StagingPanelProps): React.ReactElement | null {
  if (staging.groups.length === 0) return null;
  const byId = new Map(zone.map((card) => [card.id, card]));

  return (
    <section
      aria-label="Lay-down being built"
      className="flex flex-col gap-3 rounded border border-white/15 bg-black/25 p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-white/80">Building a lay-down</h2>
        {/* Only meaningful before getting down; afterwards any legal meld goes. */}
        {!isDown && (
          <p className="text-sm" aria-label={`Worth ${preview.value} of ${preview.minimum} needed`}>
            <span className={preview.value >= preview.minimum ? "text-emerald-300" : "text-white"}>
              {preview.value}
            </span>
            <span className="text-white/50"> / {preview.minimum}</span>
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {staging.groups.map((group) => {
          const groupPreview = preview.groups.find((g) => g.rank === group.rank);
          const focused = staging.focusedRank === group.rank;
          return (
            <li key={group.rank} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onFocus(group.rank)}
                  aria-pressed={focused}
                  // Focusing is how a wild is aimed: it has no rank of its own, so the
                  // player says which book they are spending it on.
                  className={`rounded px-2 py-0.5 text-xs ${
                    focused ? "bg-amber-300 text-black" : "border border-white/25 text-white/70"
                  }`}
                >
                  {group.rank}s{focused ? " · wilds go here" : ""}
                </button>
                <span className="text-xs text-white/50">
                  {groupPreview?.combinedSize ?? group.cardIds.length} total
                  {groupPreview && groupPreview.kind !== "incomplete" && ` · ${groupPreview.kind}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {group.cardIds.map((id) => {
                  const card = byId.get(id);
                  return card ? (
                    <PlayingCard
                      key={id}
                      card={card}
                      size="small"
                      selected
                      onSelect={() => onUnstage(id)}
                    />
                  ) : null;
                })}
              </div>
              {groupPreview?.problem && (
                <p className="text-xs text-red-300">{groupPreview.problem}</p>
              )}
            </li>
          );
        })}
      </ul>

      {preview.marvaWaived && (
        <p className="text-xs text-emerald-300">
          Below the minimum, but this lay-down empties your hand — allowed at this table.
        </p>
      )}

      {preview.emptiesHand && !preview.marvaWaived && (
        <p className="text-xs text-white/60">This lay-down empties your hand into your foot.</p>
      )}

      {/* Group problems are already shown against their group; only the lay-down-wide
          ones are repeated here, so nothing is said twice. */}
      {preview.problems
        .filter((problem) => !preview.groups.some((g) => g.problem === problem))
        .map((problem) => (
          <p key={problem} className="text-xs text-red-300">
            {problem}
          </p>
        ))}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !preview.ok}
          onClick={onCommit}
          className="rounded bg-white px-3 py-1.5 text-sm font-medium text-felt-900 disabled:opacity-40"
        >
          Play these melds
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          className="rounded border border-white/25 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Take them back
        </button>
      </div>
    </section>
  );
}
