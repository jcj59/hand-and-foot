/**
 * The round in a few lines, for the scoreboard: the books made, the best and
 * worst rounds, and who was caught holding red threes. Who went out is the
 * scoreboard's headline already, so it is not said twice.
 *
 * Worked out from the round's result alone — what every seat is sent — so the
 * recap tells nobody anything the scores do not.
 */
import type { RoundEnded } from "@hf/shared";

export function roundRecap(result: RoundEnded, nameOf: (seat: number) => string): string[] {
  // A player who had left before this round was dealt played no part in it.
  const sat = (seat: number): boolean =>
    !(result.departed ?? []).some((d) => d.seat === seat && d.afterRound < result.roundNumber);
  const scores = result.scores.filter((s) => sat(s.seat));
  const lines: string[] = [];

  const books = scores
    .filter((s) => s.breakdown.cleanBooks + s.breakdown.dirtyBooks > 0)
    .map((s) => {
      const parts = [
        ...(s.breakdown.cleanBooks > 0 ? [`${s.breakdown.cleanBooks} clean`] : []),
        ...(s.breakdown.dirtyBooks > 0 ? [`${s.breakdown.dirtyBooks} dirty`] : []),
      ];
      return `${nameOf(s.seat)} ${parts.join(", ")}`;
    });
  lines.push(books.length > 0 ? `Books: ${books.join(" · ")}.` : "No books were made this round.");

  if (scores.length > 1) {
    const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
    const worst = scores.reduce((a, b) => (b.score < a.score ? b : a));
    lines.push(`Best round: ${nameOf(best.seat)}, ${signed(best.score)}.`);
    if (worst.score < 0) lines.push(`Worst round: ${nameOf(worst.seat)}, ${signed(worst.score)}.`);
  }

  const caught = scores.filter((s) => s.breakdown.redThreesHeld > 0);
  if (caught.length > 0) {
    lines.push(
      `Caught with red threes: ${caught
        .map((s) => `${nameOf(s.seat)} (${s.breakdown.redThreesHeld})`)
        .join(", ")}.`,
    );
  }
  return lines;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
