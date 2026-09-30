import { describe, it, expect } from "vitest";
import type { Rank, Suit } from "@hf/shared";
import { newsFor } from "./moveNews";

const discard = (rank: Rank, suit: Suit | null = "spades") =>
  newsFor({ seq: 1, seat: 1, kind: "discard", card: { id: "c", rank, suit } }, "Ana")?.text;

describe("newsFor", () => {
  it("names a discard the way it is said at the table", () => {
    expect(discard("9")).toBe("Ana discarded a 9");
    expect(discard("8")).toBe("Ana discarded an 8");
    expect(discard("A")).toBe("Ana discarded an Ace");
    expect(discard("K")).toBe("Ana discarded a King");
    expect(discard("Q")).toBe("Ana discarded a Queen");
    expect(discard("J")).toBe("Ana discarded a Jack");
    expect(discard("10")).toBe("Ana discarded a 10");
    expect(discard("JOKER", null)).toBe("Ana discarded a Joker");
    expect(discard("2")).toBe("Ana discarded a 2");
  });

  it("still says who discarded when the card is not known", () => {
    expect(newsFor({ seq: 1, seat: 1, kind: "discard" }, "Ana")?.text).toBe("Ana discarded");
  });
});
