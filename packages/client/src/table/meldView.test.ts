import { describe, expect, it } from "vitest";
import { EAST_COAST, type Card, type Meld, type Rank, type Suit } from "@hf/shared";
import { booksOf, goOutProgress, meldChip, meldNote, sortMelds } from "./meldView";
import { cardShort, moveLine, withMove, MOVES_KEPT } from "./moveLine";
import { discardWarning, nameList, rankPlural } from "./discardWarning";

let next = 0;
function card(rank: Rank, suit: Suit | null = "hearts"): Card {
  return { id: `c${next++}`, rank, suit } as Card;
}
function meld(rank: Rank, naturals: number, wilds = 0): Meld {
  return {
    rank,
    cards: [
      ...Array.from({ length: naturals }, () => card(rank)),
      ...Array.from({ length: wilds }, () => card("2", "clubs")),
    ],
  };
}

describe("sorting melds", () => {
  const laid = [meld("Q", 3), meld("8", 3), meld("3", 7), meld("A", 3)];

  it("by rank puts black threes first, then the naturals ascending", () => {
    expect(sortMelds(laid, "rank").map((m) => m.rank)).toEqual(["3", "8", "Q", "A"]);
  });

  it("newest first turns the order they were laid round", () => {
    expect(sortMelds(laid, "newest").map((m) => m.rank)).toEqual(["A", "3", "8", "Q"]);
  });

  it("leaves the melds it was given alone", () => {
    sortMelds(laid, "newest");
    sortMelds(laid, "rank");
    expect(laid.map((m) => m.rank)).toEqual(["Q", "8", "3", "A"]);
  });
});

describe("what a meld says", () => {
  it("states its size and points, and once it is a book which kind", () => {
    // As the table wrote it before the redesign: the cards' own values, no bonus.
    expect(meldNote(meld("8", 4), EAST_COAST)).toEqual({ text: "4 cards · 20", tone: "open" });
    expect(meldNote(meld("K", 3, 1), EAST_COAST)).toEqual({ text: "4 cards · 50", tone: "open" });
    expect(meldNote(meld("9", 7), EAST_COAST)).toEqual({
      text: "7 cards · clean · 35",
      tone: "clean",
    });
    expect(meldNote(meld("Q", 5, 2), EAST_COAST)).toEqual({
      text: "7 cards · dirty · 90",
      tone: "dirty",
    });
    // A wild meld (twos alone) is scored at the wilds' value.
    expect(meldNote(meld("2", 0, 7), EAST_COAST)).toEqual({
      text: "7 cards · dirty · 140",
      tone: "dirty",
    });
  });

  it("says one card, not one cards", () => {
    expect(meldNote(meld("A", 1), EAST_COAST).text).toBe("1 card · 15");
  });

  it("scores by the table's own values", () => {
    const rich = { ...EAST_COAST, scoring: { ...EAST_COAST.scoring, fourToNine: 7 } };
    expect(meldNote(meld("8", 3), rich).text).toBe("3 cards · 21");
  });

  it("folds to a chip with its naturals counted and its wilds starred", () => {
    expect(meldChip(meld("7", 3))).toBe("7 ×3");
    expect(meldChip(meld("K", 4, 1))).toBe("K ×4 +★");
    expect(meldChip(meld("J", 3, 2))).toBe("J ×3 +★2");
  });

  it("lists only finished books, as clean or dirty", () => {
    expect(booksOf([meld("8", 4), meld("9", 7), meld("Q", 5, 2)])).toEqual(["clean", "dirty"]);
  });
});

describe("the go-out tracker", () => {
  it("counts clean and dirty books against what the table needs", () => {
    const progress = goOutProgress([meld("9", 7), meld("Q", 5, 2), meld("8", 5, 1)], {
      ...EAST_COAST,
      goOutCleanBooks: 1,
      goOutDirtyBooks: 2,
    });
    expect(progress.goals).toEqual([
      { label: "Clean books", have: 1, need: 1, done: true },
      { label: "Dirty books", have: 1, need: 2, done: false },
    ]);
    expect(progress.nearest).toBe("Your 8s need one more card");
  });

  it("names the unfinished meld closest to a book", () => {
    const progress = goOutProgress([meld("5", 3), meld("6", 4)], {
      ...EAST_COAST,
      goOutCleanBooks: 2,
      goOutDirtyBooks: 0,
    });
    expect(progress.nearest).toBe("Your 6s need three more cards");
    // A table that asks for no dirty book has no goal for it.
    expect(progress.goals.map((g) => g.label)).toEqual(["Clean books"]);
  });

  it("says nothing more once every book is there", () => {
    const progress = goOutProgress([meld("9", 7), meld("6", 4)], {
      ...EAST_COAST,
      goOutCleanBooks: 1,
      goOutDirtyBooks: 0,
    });
    expect(progress.goals.every((g) => g.done)).toBe(true);
    expect(progress.nearest).toBeNull();
  });

  it("asks for a dirty book with a clean one", () => {
    // Clean books do not stand in for dirty ones, as the engine counts them.
    const progress = goOutProgress([meld("9", 7), meld("10", 7)], {
      ...EAST_COAST,
      goOutCleanBooks: 1,
      goOutDirtyBooks: 1,
    });
    expect(progress.goals[1]).toEqual({ label: "Dirty books", have: 0, need: 1, done: false });
  });
});

describe("the latest move in a line", () => {
  const move = { seq: 1, seat: 1 };
  it("says every kind of move, naming a discarded card only", () => {
    expect(moveLine({ ...move, kind: "draw" }, "Kate", false)).toBe("Kate drew a card");
    expect(moveLine({ ...move, kind: "draw" }, "Kate", true)).toBe("You drew a card");
    expect(moveLine({ ...move, kind: "takePile", count: 7 }, "Kate", false)).toBe(
      "Kate took the pile (7 cards)",
    );
    expect(moveLine({ ...move, kind: "takePile", count: 1 }, "Kate", false)).toBe(
      "Kate took the pile (1 card)",
    );
    expect(moveLine({ ...move, kind: "meld", count: 3 }, "Mom", false)).toBe("Mom melded 3 cards");
    expect(moveLine({ ...move, kind: "takeBack" }, "Mom", false)).toBe("Mom took back their melds");
    expect(moveLine({ ...move, kind: "takeBack" }, "Mom", true)).toBe("You took back your melds");
    expect(
      moveLine({ ...move, kind: "discard", card: card("5", "clubs") }, "Shuffles", false),
    ).toBe("Shuffles discarded the 5♣");
    expect(moveLine({ ...move, kind: "discard" }, "Shuffles", false)).toBe("Shuffles discarded");
  });

  it("writes a joker without a suit", () => {
    expect(cardShort(card("JOKER", null))).toBe("a Joker");
  });

  it("keeps the last few moves once each, newest last", () => {
    expect(MOVES_KEPT).toBe(3);
    let list = withMove([], 1, "a");
    list = withMove(list, 1, "a");
    expect(list).toEqual([{ seq: 1, text: "a" }]);
    list = withMove(withMove(withMove(list, 2, "b"), 3, "c"), 4, "d");
    expect(list.map((m) => m.text)).toEqual(["b", "c", "d"]);
  });
});

describe("a discard that looks like a mistake", () => {
  const none = { canLayOff: false, others: [] };
  it("warns about a wild first", () => {
    expect(discardWarning(card("2"), { ...none, canLayOff: true })).toMatch(/wild card/);
    expect(discardWarning(card("JOKER", null), none)).toMatch(/wild card/);
  });

  it("names whoever could take the pile with it", () => {
    const others = [
      { name: "Kate", ranks: new Set<Rank>(["K"]) },
      { name: "Mom", ranks: new Set<Rank>(["K", "8"]) },
      { name: "Ben", ranks: new Set<Rank>(["4"]) },
    ];
    expect(discardWarning(card("8"), { canLayOff: true, others })).toBe(
      "Mom has 8s down and could take the pile with this.",
    );
    expect(discardWarning(card("K"), { canLayOff: false, others })).toBe(
      "Kate and Mom have kings down and could take the pile with this.",
    );
  });

  it("then a card that could go on the player's own meld", () => {
    expect(discardWarning(card("9"), { ...none, canLayOff: true })).toBe(
      "You have 9s down; it could go on them.",
    );
    expect(discardWarning(card("9"), none)).toBeNull();
  });

  it("says ranks and names as they are said aloud", () => {
    expect(rankPlural("A")).toBe("aces");
    expect(rankPlural("10")).toBe("10s");
    expect(nameList([])).toBe("");
    expect(nameList(["Kate"])).toBe("Kate");
    expect(nameList(["Kate", "Mom", "Ben"])).toBe("Kate, Mom and Ben");
  });
});
