import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type RulesConfig,
  type Suit,
} from "@hf/shared";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `mv${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}

const marva: RulesConfig = { ...EAST_COAST, marvaRule: true, layDownMinimums: [120] };
const noMarva: RulesConfig = { ...EAST_COAST, marvaRule: false, layDownMinimums: [120] };

function notDown(hand: Card[], config: RulesConfig): GameState {
  const p: PlayerState = {
    hand,
    foot: cards("K", 14),
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
  };
  const q: PlayerState = {
    hand: [],
    foot: [],
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
  };
  return {
    config,
    seed: 0,
    roundNumber: 1,
    players: [p, q],
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
  };
}

describe("Marva rule (round minimum 120)", () => {
  it("accepts a full-hand lay-down below the minimum and sends the player to the foot", () => {
    const fours = cards("4", 5);
    const fives = cards("5", 5);
    const sixes = cards("6", 4); // 25 + 25 + 20 = 70, below 120
    const r = applyAction(notDown([...fours, ...fives, ...sixes], marva), {
      type: "playMelds",
      melds: [
        { rank: "4", cardIds: fours.map((c) => c.id) },
        { rank: "5", cardIds: fives.map((c) => c.id) },
        { rank: "6", cardIds: sixes.map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].isDown).toBe(true);
    expect(r.state.players[0].inFoot).toBe(true);
    expect(r.state.players[0].hand).toHaveLength(0);
  });

  it("rejects the same lay-down when Marva is disabled", () => {
    const fours = cards("4", 5);
    const fives = cards("5", 5);
    const sixes = cards("6", 4);
    const r = applyAction(notDown([...fours, ...fives, ...sixes], noMarva), {
      type: "playMelds",
      melds: [
        { rank: "4", cardIds: fours.map((c) => c.id) },
        { rank: "5", cardIds: fives.map((c) => c.id) },
        { rank: "6", cardIds: sixes.map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a below-minimum lay-down that does not empty the hand even with Marva", () => {
    const fours = cards("4", 5);
    const fives = cards("5", 5);
    const sixes = cards("6", 4);
    const leftover = card("9");
    const r = applyAction(notDown([...fours, ...fives, ...sixes, leftover], marva), {
      type: "playMelds",
      melds: [
        { rank: "4", cardIds: fours.map((c) => c.id) },
        { rank: "5", cardIds: fives.map((c) => c.id) },
        { rank: "6", cardIds: sixes.map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(false);
  });
});
