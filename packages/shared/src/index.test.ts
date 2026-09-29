import { describe, it, expect } from "vitest";
import {
  isWild,
  isRed,
  isRedThree,
  isBlackThree,
  WILD_RANKS,
  EAST_COAST,
  WEST_COAST,
  type Card,
  type Rank,
  type Suit,
} from "./index";

const card = (rank: Rank, suit: Suit | null): Card => ({ id: `s-${rank}-${suit}`, rank, suit });

const ALL_RANKS: Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "JOKER",
];

describe("wild cards", () => {
  it("treats 2s and jokers as wild, everything else as natural", () => {
    expect(isWild("2")).toBe(true);
    expect(isWild("JOKER")).toBe(true);
    expect(isWild("K")).toBe(false);
    expect(isWild("A")).toBe(false);
  });

  it("is wild for exactly the two ranks in WILD_RANKS and no others", () => {
    expect(WILD_RANKS).toEqual(new Set(["2", "JOKER"]));
    const wild = ALL_RANKS.filter(isWild);
    expect(wild).toEqual(["2", "JOKER"]);
  });

  // A 3 sits next to 2 in rank order and is special-cased elsewhere, so it is the
  // rank most likely to be swept into "wild" by mistake.
  it("does not treat threes as wild", () => {
    expect(isWild("3")).toBe(false);
  });
});

describe("card colour and the special threes", () => {
  it("calls hearts and diamonds red, clubs and spades black", () => {
    expect(isRed(card("K", "hearts"))).toBe(true);
    expect(isRed(card("K", "diamonds"))).toBe(true);
    expect(isRed(card("K", "clubs"))).toBe(false);
    expect(isRed(card("K", "spades"))).toBe(false);
  });

  it("treats a suitless joker as not red", () => {
    expect(isRed(card("JOKER", null))).toBe(false);
  });

  it("recognises red threes by rank and colour together", () => {
    expect(isRedThree(card("3", "hearts"))).toBe(true);
    expect(isRedThree(card("3", "diamonds"))).toBe(true);
    expect(isRedThree(card("3", "clubs"))).toBe(false);
    // Right colour, wrong rank.
    expect(isRedThree(card("4", "hearts"))).toBe(false);
    expect(isRedThree(card("K", "hearts"))).toBe(false);
  });

  it("recognises black threes by rank and colour together", () => {
    expect(isBlackThree(card("3", "clubs"))).toBe(true);
    expect(isBlackThree(card("3", "spades"))).toBe(true);
    expect(isBlackThree(card("3", "hearts"))).toBe(false);
    expect(isBlackThree(card("4", "clubs"))).toBe(false);
  });

  it("makes the two three-predicates mutually exclusive and jointly cover the threes", () => {
    for (const suit of ["clubs", "diamonds", "hearts", "spades"] as const) {
      const three = card("3", suit);
      expect(isRedThree(three) !== isBlackThree(three)).toBe(true);
    }
    // And neither predicate ever fires on a non-three.
    for (const rank of ALL_RANKS.filter((r) => r !== "3")) {
      for (const suit of ["clubs", "hearts"] as const) {
        expect(isRedThree(card(rank, suit))).toBe(false);
        expect(isBlackThree(card(rank, suit))).toBe(false);
      }
    }
  });
});

describe("rule presets", () => {
  it("East Coast requires naturals to exceed wilds and 1 clean + 2 dirty to go out", () => {
    expect(EAST_COAST.wildRatio).toBe("naturals-exceed-wilds");
    expect(EAST_COAST.goOutCleanBooks).toBe(1);
    expect(EAST_COAST.goOutDirtyBooks).toBe(2);
  });

  it("West Coast differs only by allowing wilds to equal naturals", () => {
    expect(WEST_COAST.wildRatio).toBe("naturals-equal-wilds");
    expect(WEST_COAST.goOutCleanBooks).toBe(EAST_COAST.goOutCleanBooks);
    expect(WEST_COAST.handSize).toBe(EAST_COAST.handSize);
  });

  // "differs only by" is the actual claim, so check every other field rather than
  // the three sampled above: WEST_COAST is spread from EAST_COAST and a future edit
  // could quietly add a second difference.
  it("West Coast differs from East Coast in exactly one field", () => {
    const differing = (Object.keys(EAST_COAST) as (keyof typeof EAST_COAST)[]).filter(
      (k) => JSON.stringify(EAST_COAST[k]) !== JSON.stringify(WEST_COAST[k]),
    );
    expect(differing).toEqual(["wildRatio"]);
  });

  // The engine's scoring tests hard-code these numbers, and so does the rulebook the
  // family plays by. Pin them here so a change has to be deliberate.
  it("pins the East Coast scoring table", () => {
    expect(EAST_COAST.scoring).toEqual({
      joker: 50,
      two: 20,
      ace: 15,
      tenToKing: 10,
      fourToNine: 5,
      blackThree: 5,
      redThree: -500,
      cleanBookBonus: 500,
      dirtyBookBonus: 300,
      goOutBonus: 100,
    });
  });

  it("pins the East Coast deal and round structure", () => {
    expect(EAST_COAST.handSize).toBe(14);
    expect(EAST_COAST.footSize).toBe(14);
    expect(EAST_COAST.extraDecks).toBe(1);
    // Four rounds with escalating minimums: the house schedule, chosen 2026-09-28.
    expect(EAST_COAST.rounds).toBe(4);
    expect(EAST_COAST.layDownMinimums).toEqual([60, 90, 120, 150]);
    expect(EAST_COAST.stockExhaustion).toBe("reshuffle");
    expect(EAST_COAST.marvaRule).toBe(false);
  });

  // A red three has to be the only negative entry, because `scoreRound` subtracts
  // the magnitude of a held card's value and would turn any other negative into a
  // reward for holding it.
  it("gives the red three the only negative card value", () => {
    const { cleanBookBonus, dirtyBookBonus, goOutBonus, redThree, ...cardValues } =
      EAST_COAST.scoring;
    expect(redThree).toBeLessThan(0);
    for (const [name, value] of Object.entries(cardValues)) {
      expect(value, `${name} should not be negative`).toBeGreaterThan(0);
    }
    expect(Math.min(cleanBookBonus, dirtyBookBonus, goOutBonus)).toBeGreaterThan(0);
  });

  it("makes a clean book worth more than a dirty one", () => {
    expect(EAST_COAST.scoring.cleanBookBonus).toBeGreaterThan(EAST_COAST.scoring.dirtyBookBonus);
  });

  it("configures every part of the turn clock", () => {
    const { baseMs, incrementMs, capMs, discardGraceMs } = EAST_COAST.timers;
    for (const ms of [baseMs, incrementMs, capMs, discardGraceMs]) {
      expect(ms).toBeGreaterThan(0);
    }
  });

  it("caps a turn above the clock it starts with, leaving room for increments", () => {
    // A cap at or below the base would make the increment dead config: the turn
    // would end at the base no matter how much the player earned.
    expect(EAST_COAST.timers.capMs).toBeGreaterThan(EAST_COAST.timers.baseMs);
    expect(EAST_COAST.timers.incrementMs).toBeLessThan(EAST_COAST.timers.baseMs);
  });

  it("caps melding at three minutes and keeps the grace on top short", () => {
    // Two separate promises, and the second is not "three minutes": the grace
    // sits on top of the cap by design, so the real worst case for a whole turn
    // is cap + grace. Pin both so neither quietly becomes unbounded.
    const { capMs, discardGraceMs } = EAST_COAST.timers;
    expect(capMs).toBe(180_000);
    expect(capMs + discardGraceMs).toBeLessThanOrEqual(200_000);
  });

  it("pairs the family mode with pausing enabled", () => {
    expect(EAST_COAST.mode).toBe("family");
    expect(EAST_COAST.pauseEnabled).toBe(true);
  });
});
