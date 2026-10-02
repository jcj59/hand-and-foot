/**
 * A table's rules, for everyone waiting to play by them.
 *
 * Whoever opened the table may have changed the preset, and the others did not
 * choose: so what changed is listed up front, each with what the preset has, and
 * the rest is a tap away. A table played exactly as the preset says only names it.
 */
import type { RulesConfig } from "@hf/shared";
import { ruleLines, RULE_GROUPS, rulesName, type RuleLine } from "./ruleText";

export function RulesSummary({ config }: { readonly config: RulesConfig }): React.ReactElement {
  const lines = ruleLines(config);
  const changed = lines.filter((line) => line.was !== null);
  return (
    <section aria-label="Table rules" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-white/80">
        Rules: {rulesName(config)}
        {changed.length > 0 && (
          <span className="ml-2 rounded bg-amber-300/20 px-1.5 py-0.5 text-xs text-amber-200">
            {changed.length} changed
          </span>
        )}
      </h2>
      {changed.length > 0 && (
        <ul aria-label="Changed from the preset" className="flex flex-col gap-1">
          {changed.map((line) => (
            <Line key={line.id} line={line} />
          ))}
        </ul>
      )}
      <details className="rounded border border-white/10 bg-black/15 p-2 text-sm">
        <summary className="cursor-pointer text-white/70">All rules</summary>
        <div className="mt-2 flex flex-col gap-3">
          {RULE_GROUPS.map((group) => (
            <div key={group}>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-white/50 uppercase">
                {group}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {lines
                  .filter((line) => line.group === group)
                  .map((line) => (
                    <Line key={line.id} line={line} />
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function Line({ line }: { readonly line: RuleLine }): React.ReactElement {
  const changed = line.was !== null;
  return (
    <li
      data-changed={changed || undefined}
      className={`flex items-baseline justify-between gap-3 rounded px-2 py-0.5 text-sm ${
        changed ? "bg-amber-300/10 ring-1 ring-amber-300/50" : ""
      }`}
    >
      <span className="text-white/70">{line.label}</span>
      <span className="text-right">
        <span className={changed ? "font-medium text-amber-100" : "text-white"}>{line.value}</span>
        {changed && (
          <>
            <span className="sr-only">, the preset has </span>
            <span className="ml-2 text-xs text-white/50 line-through">{line.was}</span>
          </>
        )}
      </span>
    </li>
  );
}
