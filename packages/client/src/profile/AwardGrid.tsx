/**
 * Profile's awards: every award a match can give, in the order the table
 * announces them, each with how many matches gave it to this player ("×2") or
 * "Not yet". An award won is tinted its own color; one not won yet is gray.
 */
import { AWARDS } from "@hf/shared";
import { AwardIcon, awardColor } from "../table/awards";

export function AwardGrid({
  counts,
  phone,
}: {
  /** Matches won per award id, from `PlayerStats.awards`; null before any history arrives. */
  readonly counts: Readonly<Record<string, number>> | null;
  readonly phone: boolean;
}): React.ReactElement {
  return (
    <section aria-label="Awards" className={`flex flex-col ${phone ? "gap-2" : "gap-2.5"}`}>
      <SectionHeading>Awards</SectionHeading>
      <ul className={`m-0 grid list-none grid-cols-3 p-0 ${phone ? "gap-2" : "gap-2.5"}`}>
        {AWARDS.map(({ id, title }) => {
          const n = counts?.[id] ?? 0;
          const color = awardColor(id);
          return (
            <li
              key={id}
              data-award={id}
              className={`flex flex-col gap-2 rounded-[14px] border p-2.5 ${phone ? "min-h-24" : "min-h-28"} ${
                n ? "text-ink" : "border-white/5 bg-surface text-faint"
              }`}
              style={
                n
                  ? {
                      background: `linear-gradient(160deg, ${color}22, var(--color-surface) 80%)`,
                      borderColor: `${color}55`,
                    }
                  : undefined
              }
            >
              <span className="flex items-center justify-between">
                <AwardIcon id={id} size={phone ? 30 : 36} glyph={phone ? 17 : 20} earned={n > 0} />
                <span aria-hidden="true" className="font-display text-sm font-bold">
                  {n ? `×${n}` : "Not yet"}
                </span>
              </span>
              <span className="text-[11px] leading-tight">{title}</span>
              <span className="sr-only">
                {n ? `won ${n === 1 ? "once" : `${n} times`}` : "not won yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The small capitals over each of Profile's sections. */
export function SectionHeading({ children }: { readonly children: React.ReactNode }) {
  return (
    <h2 className="m-0 text-xs font-semibold tracking-[0.08em] text-faint uppercase">{children}</h2>
  );
}
