/**
 * One scoreboard row opened up: the cards the player was left holding, what each
 * one cost, and how the round's score adds up.
 *
 * The groups are `heldBreakdown`'s (hand, foot, red threes), each with its count
 * and sum, so "never got into the foot" reads as a line of its own with the
 * fourteen cards it cost. The last line is the round's score as the engine adds
 * it: book bonuses, cards melded, going out and the cards left, which on a phone
 * is the only place the parts appear.
 */
import type { HeldCards, RulesConfig, ScoreBreakdown } from "@hf/shared";
import { PlayingCard } from "../cards/PlayingCard";
import { heldBreakdown, type HeldGroup } from "./heldBreakdown";

/** A signed number the way a scoreboard writes one: "+1,245", "-140". */
export function signed(n: number): string {
  const digits = Math.abs(n).toLocaleString("en-US");
  return n > 0 ? `+${digits}` : n < 0 ? `-${digits}` : "0";
}

function cardsWord(n: number): string {
  return `${n} card${n === 1 ? "" : "s"}`;
}

export interface HeldDetailProps {
  readonly id: string;
  /** How the row names the player: "You" or their name. */
  readonly name: string;
  readonly held: HeldCards;
  readonly breakdown: ScoreBreakdown;
  readonly score: number;
  readonly config: RulesConfig;
}

export function HeldDetail({
  id,
  name,
  held,
  breakdown: b,
  score,
  config,
}: HeldDetailProps): React.ReactElement {
  const d = heldBreakdown(held, config);
  const groups: { readonly label: string; readonly group: HeldGroup }[] = [
    { label: `Hand, ${cardsWord(d.hand.cards.length)}`, group: d.hand },
    {
      label: `Foot, ${cardsWord(d.foot.cards.length)}${d.footUntouched ? ", never reached" : ""}`,
      group: d.foot,
    },
    {
      label: `Red threes, ${d.redThrees.cards.length}`,
      group: d.redThrees,
    },
  ].filter((g) => g.group.cards.length > 0);
  const parts: [string, number][] = [
    ["Books", b.bookBonus],
    ["Cards melded", b.meldedCards],
    ["Going out", b.goOutBonus],
    ["Cards left", b.heldPenalty],
  ];
  return (
    <div
      id={id}
      role="region"
      aria-label={`${name === "You" ? "Your" : `${name}'s`} cards`}
      className="col-span-full mt-1 flex flex-col gap-2.5 rounded-xl bg-black/20 p-2.5"
    >
      {groups.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">No cards left in hand or foot.</p>
      ) : (
        <ul aria-label="Cards left" className="m-0 flex list-none flex-col gap-2.5 p-0">
          {groups.map(({ label, group }) => (
            <li key={label} aria-label={`${label}: ${signed(group.sum)}`}>
              <p className="m-0 flex items-baseline justify-between gap-2 text-[12px]">
                <span className="font-semibold text-ink-soft">{label}</span>
                <span className="font-display font-bold text-salmon tabular-nums">
                  {signed(group.sum)}
                </span>
              </p>
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {group.cards.map(({ card, cost }) => (
                  <span key={card.id} className="flex flex-col items-center gap-0.5">
                    <PlayingCard card={card} size="small" dimmed={false} />
                    <span className="text-[10px] text-muted tabular-nums">{signed(cost)}</span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-white/8 pt-2 text-[12px] text-muted">
        {parts.map(([label, n]) => (
          <span key={label}>
            {label} <span className="font-semibold text-ink-soft tabular-nums">{signed(n)}</span>
          </span>
        ))}
        <span className="ml-auto">
          Round{" "}
          <span
            className={`font-display font-bold tabular-nums ${score >= 0 ? "text-accent" : "text-salmon"}`}
          >
            {signed(score)}
          </span>
        </span>
      </p>
    </div>
  );
}
