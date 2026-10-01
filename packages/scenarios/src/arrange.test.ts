import { describe, it, expect } from "vitest";
import { EAST_COAST, type Card, type GameState } from "@hf/shared";
import { buildShoe } from "@hf/engine";
import { arrange } from "./arrange";

function everyCard(state: GameState): Card[] {
  return [
    ...state.players.flatMap((p) => [...p.hand, ...p.foot, ...p.melds.flatMap((m) => m.cards)]),
    ...state.stock,
    ...state.discard,
  ];
}
const ids = (cards: readonly Card[]) => cards.map((c) => c.id).sort();
const text = (cards: readonly Card[]) =>
  cards.map((c) => (c.suit ? `${c.rank}${c.suit[0]!.toUpperCase()}` : "JK")).join(" ");

describe("arranging a table by hand", () => {
  it("places the named cards and deals the rest of a real shoe, every card exactly once", () => {
    const state = arrange(
      {
        seed: 3,
        seats: [{ hand: "KH KS 2C", melds: { Q: "QC QD QH" } }, { foot: "JK 3D" }, {}],
        discard: "4C 9H",
        stockTop: "AS 5D",
        currentSeat: 1,
        phase: "play",
        roundNumber: 3,
      },
      EAST_COAST,
    );
    expect(ids(everyCard(state))).toEqual(ids(buildShoe(3, EAST_COAST.extraDecks)));
    const [ana, ben, cal] = state.players;
    expect(text(ana!.hand)).toBe("KH KS 2C");
    expect(ana!.melds).toHaveLength(1);
    expect(ana!.isDown).toBe(true);
    expect(ana!.foot).toHaveLength(EAST_COAST.footSize);
    expect(ben!.isDown).toBe(false);
    expect(ben!.hand).toHaveLength(EAST_COAST.handSize);
    expect(text(ben!.foot)).toBe("JK 3D");
    expect(cal!.hand).toHaveLength(EAST_COAST.handSize);
    expect(text(state.discard)).toBe("4C 9H");
    expect(text(state.stock.slice(0, 2))).toBe("AS 5D");
    expect(state).toMatchObject({ currentSeat: 1, phase: "play", roundNumber: 3, seed: 3 });
  });

  it("gives a player in the foot an empty hand unless told otherwise", () => {
    const state = arrange({ seed: 1, seats: [{ inFoot: true, foot: "7C" }, {}] }, EAST_COAST);
    expect(state.players[0]!.hand).toEqual([]);
    expect(state.players[0]!.inFoot).toBe(true);
  });

  it("deals the same table from the same seed, and a different one from another", () => {
    const spec = { seats: [{}, {}] };
    expect(arrange({ ...spec, seed: 5 }, EAST_COAST)).toEqual(
      arrange({ ...spec, seed: 5 }, EAST_COAST),
    );
    expect(arrange({ ...spec, seed: 5 }, EAST_COAST).stock).not.toEqual(
      arrange({ ...spec, seed: 6 }, EAST_COAST).stock,
    );
  });

  it("flips a card to start the pile only when the rules do and none is given", () => {
    expect(arrange({ seed: 1, seats: [{}, {}] }, EAST_COAST).discard).toHaveLength(1);
    const noFlip = { ...EAST_COAST, initialDiscardFlip: false };
    expect(arrange({ seed: 1, seats: [{}, {}] }, noFlip).discard).toHaveLength(0);
    expect(arrange({ seed: 1, seats: [{}, {}], discard: "" }, EAST_COAST).discard).toHaveLength(0);
  });

  it("shortens the stock by burying the rest under the pile", () => {
    const state = arrange(
      { seed: 2, seats: [{}, {}], stockTop: "AS", stockSize: 3, discard: "9H" },
      EAST_COAST,
    );
    expect(state.stock).toHaveLength(3);
    expect(text(state.stock.slice(0, 1))).toBe("AS");
    expect(text(state.discard.slice(-1))).toBe("9H");
    expect(ids(everyCard(state))).toEqual(ids(buildShoe(2, EAST_COAST.extraDecks)));
  });

  it("refuses what a shoe cannot hold", () => {
    // Three decks for two players hold six jokers.
    expect(() => arrange({ seed: 1, seats: [{ hand: "JK ".repeat(7) }, {}] }, EAST_COAST)).toThrow(
      "no JK left in the shoe for seat 0's hand",
    );
    expect(() =>
      arrange({ seed: 1, seats: [{}, {}], stockTop: "AS AH", stockSize: 1 }, EAST_COAST),
    ).toThrow(/stockSize is smaller/);
    const huge = { ...EAST_COAST, handSize: 200 };
    expect(() => arrange({ seed: 1, seats: [{}, {}] }, huge)).toThrow(/ran out/);
  });
});
