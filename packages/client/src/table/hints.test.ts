import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EAST_COAST, type Card, type PlayerView, type Rank, type Suit } from "@hf/shared";
import { heuristicAction } from "@hf/engine";
import { HINTS_KEY, readHints, shortCard, suggestionFor, writeHints } from "./hints";

let idc = 0;
const card = (rank: Rank, suit: Suit | null = "clubs"): Card => ({
  id: `h${idc++}`,
  rank,
  suit: rank === "JOKER" ? null : suit,
});

function view(over: Partial<PlayerView> = {}): PlayerView {
  return {
    seat: 0,
    hand: [],
    foot: null,
    footCount: 11,
    melds: [],
    isDown: false,
    inFoot: false,
    opponents: [{ seat: 1, handCount: 11, footCount: 11, melds: [], isDown: false, inFoot: false }],
    discard: [card("4", "hearts")],
    stockCount: 50,
    currentSeat: 0,
    phase: "draw",
    roundNumber: 1,
    pickedUp: [],
    playedThisTurn: [],
    wentOutSeat: null,
    finalLapRemaining: null,
    scoresSoFar: [0, 0],
    departed: [],
    ...over,
  };
}

beforeEach(() => window.localStorage.removeItem(HINTS_KEY));
afterEach(() => vi.restoreAllMocks());

describe("whether hints are on", () => {
  it("defaults to on at a family table and off at a competitive one", () => {
    expect(readHints("family")).toBe(true);
    expect(readHints("competitive")).toBe(false);
  });

  it("follows the device's own choice, either way, whatever the table", () => {
    writeHints(false);
    expect(window.localStorage.getItem(HINTS_KEY)).toBe("0");
    expect(readHints("family")).toBe(false);
    writeHints(true);
    expect(readHints("competitive")).toBe(true);
  });

  it("falls back to the table's default when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readHints("family")).toBe(true);
    expect(() => writeHints(false)).not.toThrow();
  });
});

describe("a suggested move", () => {
  it("says what the computer player would do from this view, and nothing on another's turn", () => {
    expect(suggestionFor(view(), EAST_COAST)).toEqual({
      text: "Draw from the stock.",
      cardIds: new Set(),
    });
    expect(suggestionFor(view({ currentSeat: 1 }), EAST_COAST)).toBeNull();
  });

  it("names the pile when it would take it", () => {
    const kings = [card("K", "spades"), card("K", "hearts"), card("K", "diamonds")];
    const v = view({
      hand: [...kings.slice(0, 2), card("A"), card("A", "hearts"), card("A", "spades"), card("5")],
      discard: [kings[2]!],
    });
    expect(heuristicAction(v, EAST_COAST)).toEqual({ type: "takePile" });
    expect(suggestionFor(v, EAST_COAST)!.text).toBe("Take the pile.");
  });

  it("names the card to discard, and rings it", () => {
    const nine = card("9", "diamonds");
    const v = view({ phase: "play", isDown: true, hand: [nine] });
    const s = suggestionFor(v, EAST_COAST)!;
    expect(heuristicAction(v, EAST_COAST)).toEqual({ type: "discard", cardId: nine.id });
    expect(s).toEqual({ text: "Discard the 9♦.", cardIds: new Set([nine.id]) });
  });

  it("names the cards of a lay-down, new melds and ones laid onto, and rings them all", () => {
    const aces = [card("A", "hearts"), card("A", "spades"), card("A", "clubs")];
    const king = card("K", "hearts");
    const v = view({
      phase: "play",
      isDown: true,
      melds: [{ rank: "K", cards: [card("K"), card("K", "spades"), card("K", "diamonds")] }],
      hand: [...aces, king, card("6"), card("7", "hearts")],
    });
    const action = heuristicAction(v, EAST_COAST);
    expect(action?.type).toBe("playMelds");
    const s = suggestionFor(v, EAST_COAST)!;
    expect(s.text).toContain("A♥ A♠ A♣ as As");
    expect(s.text).toContain("K♥ onto your Ks");
    expect(s.text.startsWith("Meld ")).toBe(true);
    expect([...s.cardIds].sort()).toEqual([...aces, king].map((c) => c.id).sort());
  });

  it("puts a card as it reads on its corner", () => {
    expect(shortCard(card("10", "diamonds"))).toBe("10♦");
    expect(shortCard(card("JOKER"))).toBe("Joker");
  });
});
