import { describe, expect, it } from "vitest";
import { EAST_COAST, type Card, type Meld, type Rank, type Suit } from "@hf/shared";
import { booksOf, meldChip, meldNote, sortMelds } from "./meldView";
import { cardShort, moveLine, withMove, MOVES_KEPT } from "./moveLine";

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
