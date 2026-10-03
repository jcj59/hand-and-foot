import { describe, it, expect } from "vitest";
import { AWARDS, awards } from "./awards";
import type { SeatTally } from "./matches";

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

describe("the awards at the end of a match", () => {
  it("go to whoever did the most of each, in the order they are announced", () => {
    const result = awards([
      tally({ grabbyPants: 2, cleanBooks: 1, wentOut: 3, pilesTaken: 5 }),
      tally({ grabbyPants: 1, marvaRules: 1, cleanBooks: 4, redThreesEaten: 2, pilesTaken: 1 }),
    ]);
    expect(result).toEqual([
      {
        id: "grabby",
        title: "Grabby Pants champion",
        seats: [0],
        count: 2,
        what: "Grabby Pants 2 times",
      },
      { id: "marva", title: "Marva's favourite", seats: [1], count: 1, what: "one Marva Rule" },
      { id: "clean", title: "Cleanest books", seats: [1], count: 4, what: "4 clean books" },
      { id: "out", title: "First out the door", seats: [0], count: 3, what: "went out 3 times" },
      { id: "pile", title: "Pile collector", seats: [0], count: 5, what: "took the pile 5 times" },
      {
        id: "red-threes",
        title: "Ate the most red threes",
        seats: [1],
        count: 2,
        what: "2 red threes",
      },
    ]);
  });

  it("are shared on a tie, and left out when nobody earned them", () => {
    const result = awards([tally({ cleanBooks: 2 }), tally({ cleanBooks: 2 }), tally()]);
    expect(result).toEqual([
      { id: "clean", title: "Cleanest books", seats: [0, 1], count: 2, what: "2 clean books" },
    ]);
    expect(awards([tally(), tally()])).toEqual([]);
  });

  it("leave out the seats asked, such as players who left", () => {
    const result = awards([tally({ wentOut: 1 }), tally({ wentOut: 2 })], (seat) => seat === 1);
    expect(result).toEqual([
      { id: "out", title: "First out the door", seats: [0], count: 1, what: "went out once" },
    ]);
  });

  it("count a tally from before red threes were counted as none", () => {
    const { redThreesEaten: _, ...old } = tally({ wentOut: 1 });
    void _;
    expect(awards([old]).map((a) => a.id)).toEqual(["out"]);
  });

  it("say each count in words, one and many", () => {
    expect(AWARDS.map((a) => [a.what(1), a.what(3)])).toEqual([
      ["Grabby Pants once", "Grabby Pants 3 times"],
      ["one Marva Rule", "3 Marva Rules"],
      ["one clean book", "3 clean books"],
      ["went out once", "went out 3 times"],
      ["took the pile once", "took the pile 3 times"],
      ["one red three", "3 red threes"],
    ]);
  });
});
