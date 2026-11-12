/**
 * The player's own melds, on the felt under the piles: sorted by rank or newest
 * first (the same order the other players' melds take), folded to chips with
 * Collapse, and, once the player is in their foot, the books they still need to
 * go out.
 *
 * The order and the fold are per device, like the rest of the table's display
 * choices.
 */
import type { Meld, Rank, RulesConfig } from "@hf/shared";
import { usePhone } from "../usePhone";
import { Melds } from "./Melds";
import { goOutProgress, type MeldOrder } from "./meldView";

export interface MeldsPanelProps {
  readonly title: string;
  readonly melds: readonly Meld[];
  readonly config: RulesConfig;
  readonly order: MeldOrder;
  readonly onOrder: (order: MeldOrder) => void;
  readonly collapsed: boolean;
  readonly onCollapsed: (collapsed: boolean) => void;
  /** Said when nothing is down yet. */
  readonly empty: string;
  /** In the foot: show the books still needed to go out. */
  readonly inFoot: boolean;
  readonly onSelect?: (rank: Rank) => void;
  readonly selectedRank?: Rank | null;
  readonly provisionalIds?: ReadonlySet<string>;
}

export function MeldsPanel({
  title,
  melds,
  config,
  order,
  onOrder,
  collapsed,
  onCollapsed,
  empty,
  inFoot,
  onSelect,
  selectedRank,
  provisionalIds,
}: MeldsPanelProps): React.ReactElement {
  const phone = usePhone();
  const progress = inFoot ? goOutProgress(melds, config) : null;
  const sorts: readonly [MeldOrder, string][] = [
    ["rank", phone ? "Rank" : "By rank"],
    ["newest", phone ? "Newest" : "Newest first"],
  ];
  return (
    <section
      aria-label={title}
      data-zone="melds"
      className="flex flex-col gap-2 rounded-2xl bg-black/22 p-2.5 md:px-3.5 md:py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 flex-1 text-[13px] font-semibold md:text-sm">{title}</h2>
        <div role="group" aria-label="Sort melds" className="flex items-center gap-1.5">
          {!phone && <span className="text-xs text-ink/70">Sort</span>}
          <span className="flex gap-0.5 rounded-[9px] bg-black/30 p-0.5">
            {sorts.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={order === value}
                onClick={() => onOrder(value)}
                className={`min-h-7 rounded-[7px] px-2 text-[11px] font-semibold md:min-h-[30px] md:px-2.5 md:text-xs ${
                  order === value ? "bg-ink text-[#11161A]" : "text-ink/75 hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        {melds.length > 0 && (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => onCollapsed(!collapsed)}
            className="min-h-8 rounded-[9px] bg-white/12 px-2.5 text-xs font-semibold hover:bg-white/18"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        )}
      </div>
      {melds.length === 0 && <p className="m-0 text-[13px] text-ink/70">{empty}</p>}
      {progress && progress.goals.length > 0 && (
        <div aria-label="To go out" role="group" className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-ink/75">To go out</span>
          {progress.goals.map((goal) => (
            <span
              key={goal.label}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold ${
                goal.done ? "bg-accent/18 text-[#9EF0C7]" : "bg-black/30 text-ink"
              }`}
            >
              {goal.label}{" "}
              <span className="font-mono">{goal.done ? "✓" : `${goal.have}/${goal.need}`}</span>
            </span>
          ))}
          {progress.nearest && <span className="text-xs text-gold-soft">{progress.nearest}</span>}
        </div>
      )}
      {melds.length > 0 && (
        <Melds
          melds={melds}
          config={config}
          order={order}
          chips={collapsed}
          onSelect={onSelect}
          selectedRank={selectedRank}
          provisionalIds={provisionalIds}
        />
      )}
    </section>
  );
}
