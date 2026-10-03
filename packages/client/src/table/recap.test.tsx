import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { RoundEnded, ScoreBreakdown, SeatTally } from "@hf/shared";
import { roundRecap } from "./recap";
import { AWARDS_MS, AwardsCelebration, awardsOf, useAwardsCelebration, winnersOf } from "./awards";

const names = ["Ana", "Ben", "Cy"];
const nameOf = (seat: number): string => names[seat]!;

function bd(over: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    cleanBooks: 0,
    dirtyBooks: 0,
    bookBonus: 0,
    meldedCards: 0,
    goOutBonus: 0,
    heldCount: 0,
    heldPenalty: 0,
    redThreesHeld: 0,
    ...over,
  };
}

function result(
  scores: [number, Partial<ScoreBreakdown>][],
  over: Partial<RoundEnded> = {},
): RoundEnded {
  return {
    scores: scores.map(([score, b], seat) => ({ seat, score, breakdown: bd(b) })),
    roundNumber: 2,
    totals: scores.map(([score]) => score),
    matchOver: false,
    ...over,
  };
}

const tally = (over: Partial<SeatTally> = {}): SeatTally => ({
  pilesTaken: 0,
  grabbyPants: 0,
  marvaRules: 0,
  wentOut: 0,
  cleanBooks: 0,
  dirtyBooks: 0,
  redThreesEaten: 0,
  ...over,
});

afterEach(() => vi.useRealTimers());

describe("the round in a few lines", () => {
  it("names the books made, the best and worst rounds, and the red threes caught", () => {
    const r = result([
      [1850, { cleanBooks: 1, dirtyBooks: 2 }],
      [-320, { redThreesHeld: 1 }],
      [400, { dirtyBooks: 1 }],
    ]);
    expect(roundRecap(r, nameOf)).toEqual([
      "Books: Ana 1 clean, 2 dirty · Cy 1 dirty.",
      "Best round: Ana, +1850.",
      "Worst round: Ben, -320.",
      "Caught with red threes: Ben (1).",
    ]);
  });

  it("says when nobody made a book, and names no worst round when nobody lost points", () => {
    expect(
      roundRecap(
        result([
          [0, {}],
          [40, {}],
        ]),
        nameOf,
      ),
    ).toEqual(["No books were made this round.", "Best round: Ben, +40."]);
  });

  it("leaves out a player who had left before the round was dealt", () => {
    // Their nought would otherwise be the best round at a table where everyone lost points.
    const r = result(
      [
        [-100, {}],
        [0, {}],
        [-50, {}],
      ],
      {
        departed: [{ seat: 1, afterRound: 1 }],
      },
    );
    expect(roundRecap(r, nameOf)).toEqual([
      "No books were made this round.",
      "Best round: Cy, -50.",
      "Worst round: Ana, -100.",
    ]);
  });
});

describe("the awards", () => {
  const final = result(
    [
      [0, {}],
      [0, {}],
      [0, {}],
    ],
    {
      matchOver: true,
      roundNumber: 4,
      tallies: [
        tally({ cleanBooks: 3 }),
        tally({ cleanBooks: 5, wentOut: 1 }),
        tally({ cleanBooks: 3 }),
      ],
    },
  );

  it("come with the final result only, and leave out anyone who left", () => {
    expect(awardsOf(final).map((a) => [a.id, a.seats])).toEqual([
      ["clean", [1]],
      ["out", [1]],
    ]);
    expect(
      awardsOf({ ...final, departed: [{ seat: 1, afterRound: 2 }] }).map((a) => [a.id, a.seats]),
    ).toEqual([["clean", [0, 2]]]);
    expect(awardsOf({ ...final, matchOver: false })).toEqual([]);
    expect(awardsOf({ ...final, tallies: undefined })).toEqual([]);
  });

  it("name their winners, a tie together", () => {
    const [clean] = awardsOf({ ...final, departed: [{ seat: 1, afterRound: 2 }] });
    expect(winnersOf(clean!, nameOf)).toBe("Ana and Cy (3 clean books)");
  });

  it("stay up six seconds", () => {
    expect(AWARDS_MS).toBe(6_000);
  });

  function Probe({ r, quiet = false }: { r: RoundEnded | null; quiet?: boolean }) {
    const shown = useAwardsCelebration(r, quiet);
    return shown ? <AwardsCelebration shown={shown} nameOf={nameOf} /> : null;
  }

  it("are announced when the match ends while the page is open, and go after their time", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe r={null} />);
    expect(screen.queryByRole("status", { name: "Awards" })).toBeNull();
    rerender(<Probe r={final} />);
    expect(screen.getByRole("status", { name: "Awards" })).toHaveTextContent(
      "Cleanest books: Ben (5 clean books)",
    );
    // The same result sent again does not start it over or keep it up.
    act(() => vi.advanceTimersByTime(AWARDS_MS - 1));
    rerender(<Probe r={{ ...final }} />);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status", { name: "Awards" })).toBeNull();
  });

  it("are not announced for a match the page opened on already over, nor on a silent jump", () => {
    render(<Probe r={final} />);
    expect(screen.queryByRole("status", { name: "Awards" })).toBeNull();
    const { rerender } = render(<Probe r={null} quiet />);
    rerender(<Probe r={final} quiet />);
    expect(screen.queryByRole("status", { name: "Awards" })).toBeNull();
  });

  it("are not announced when nobody earned any", () => {
    const { rerender } = render(<Probe r={null} />);
    rerender(<Probe r={{ ...final, tallies: [tally(), tally(), tally()] }} />);
    expect(screen.queryByRole("status", { name: "Awards" })).toBeNull();
  });
});
