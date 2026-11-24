import { describe, expect, it } from "vitest";
import { EAST_COAST, type Card, type Meld, type Rank, type Suit } from "@hf/shared";
import { booksOf, goOutProgress, meldChip, meldLabel, meldNote, sortMelds } from "./meldView";
import { cardShort, moveLine, withMove, MOVES_KEPT } from "./moveLine";
import { discardWarning, rankPlural } from "./discardWarning";

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

  it("folds to a chip with its whole size and each wild by its own rank", () => {
    expect(meldChip(meld("7", 3))).toEqual({ rank: "7", count: 3, tone: "open", wilds: [] });
    // Six cards in all, not the four naturals; the wilds as what they are.
    const kings: Meld = {
      rank: "K",
      cards: [card("JOKER", null), card("K"), card("K"), card("2", "spades"), card("K"), card("K")],
    };
    expect(meldChip(kings)).toEqual({ rank: "K", count: 6, tone: "open", wilds: ["2", "JK"] });
    // Twos before jokers, whatever order they were laid in, as a fan draws them.
    const jacks: Meld = {
      rank: "J",
      cards: [card("JOKER", null), card("J"), card("2", "spades"), card("J"), card("JOKER", null)],
    };
    expect(meldChip(jacks).wilds).toEqual(["2", "JK", "JK"]);
    const twos: Meld = {
      rank: "8",
      cards: [card("2", "clubs"), card("8"), card("2", "hearts"), card("8"), card("8")],
    };
    expect(meldChip(twos).wilds).toEqual(["2", "2"]);
  });

  it("colors a folded book by its kind", () => {
    expect(meldChip(meld("9", 7))).toEqual({ rank: "9", count: 7, tone: "clean", wilds: [] });
    expect(meldChip(meld("Q", 6, 2))).toEqual({
      rank: "Q",
      count: 8,
      tone: "dirty",
      wilds: ["2", "2"],
    });
  });

  it("names a meld by its rank, size and wilds", () => {
    expect(meldLabel(meld("K", 4, 2))).toBe("Meld of Ks, 6 cards, 2 wild");
    expect(meldLabel(meld("K", 3, 1))).toBe("Meld of Ks, 4 cards, 1 wild");
    expect(meldLabel(meld("8", 3))).toBe("Meld of 8s, 3 cards");
    expect(meldLabel(meld("A", 1))).toBe("Meld of As, 1 card");
    expect(meldLabel(meld("9", 7))).toBe("clean book of 9s, 7 cards");
    expect(meldLabel(meld("Q", 5, 2))).toBe("dirty book of Qs, 7 cards, 2 wild");
  });

  it("lists only finished books, as clean or dirty", () => {
    expect(booksOf([meld("8", 4), meld("9", 7), meld("Q", 5, 2)])).toEqual(["clean", "dirty"]);
  });
});

describe("the go-out status", () => {
  it("counts clean and dirty books against what the table needs", () => {
    const goals = goOutProgress([meld("9", 7), meld("Q", 5, 2), meld("8", 5, 1)], {
      ...EAST_COAST,
      goOutCleanBooks: 1,
      goOutDirtyBooks: 2,
    });
    expect(goals).toEqual([
      { label: "Clean books", have: 1, need: 1, done: true },
      { label: "Dirty books", have: 1, need: 2, done: false },
    ]);
  });

  it("has no goal for a kind the table asks none of", () => {
    const config = { ...EAST_COAST, goOutCleanBooks: 2, goOutDirtyBooks: 0 };
    expect(goOutProgress([meld("5", 3), meld("6", 4)], config)).toEqual([
      { label: "Clean books", have: 0, need: 2, done: false },
    ]);
    expect(
      goOutProgress([], { ...EAST_COAST, goOutCleanBooks: 0, goOutDirtyBooks: 1 }).map(
        (g) => g.label,
      ),
    ).toEqual(["Dirty books"]);
  });

  it("is done at exactly the number needed, and past it", () => {
    const config = { ...EAST_COAST, goOutCleanBooks: 1, goOutDirtyBooks: 1 };
    expect(goOutProgress([meld("9", 7), meld("10", 7), meld("J", 6, 1)], config)).toEqual([
      { label: "Clean books", have: 2, need: 1, done: true },
      { label: "Dirty books", have: 1, need: 1, done: true },
    ]);
  });

  it("does not let a clean book stand in for a dirty one", () => {
    // As the engine counts them.
    const goals = goOutProgress([meld("9", 7), meld("10", 7)], {
      ...EAST_COAST,
      goOutCleanBooks: 1,
      goOutDirtyBooks: 1,
    });
    expect(goals[1]).toEqual({ label: "Dirty books", have: 0, need: 1, done: false });
  });
});

describe("a discard that fits the player's own meld", () => {
  it("is said, by the rank in words", () => {
    expect(discardWarning(card("9"), true)).toBe("You have 9s down; it could go on them.");
    expect(discardWarning(card("K"), true)).toBe("You have kings down; it could go on them.");
  });

  it("is the only discard said anything about", () => {
    expect(discardWarning(card("9"), false)).toBeNull();
    expect(discardWarning(card("JOKER", null), false)).toBeNull();
  });

  it("says ranks as they are said aloud", () => {
    expect(rankPlural("A")).toBe("aces");
    expect(rankPlural("J")).toBe("jacks");
    expect(rankPlural("Q")).toBe("queens");
    expect(rankPlural("3")).toBe("threes");
    expect(rankPlural("10")).toBe("10s");
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
