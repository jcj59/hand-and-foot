import { describe, it, expect } from "vitest";
import { EAST_COAST, WEST_COAST, type Card, type Rank, type Suit } from "@hf/shared";
import {
  EMPTY_STAGING,
  focusGroup,
  previewLayDown,
  retainCards,
  settlesObligation,
  stageCard,
  stagedCount,
  stagedIds,
  toMeldPlays,
  unstageCard,
  type PreviewParams,
  type Staging,
} from "./staging";

let counter = 0;
function card(rank: Rank, suit: Suit | null = "clubs"): Card {
  return { id: `c${counter++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number, suit: Suit = "clubs"): Card[] {
  return Array.from({ length: n }, () => card(rank, suit));
}

/** Stage a run of cards in order. */
function stageAll(cardList: readonly Card[], from: Staging = EMPTY_STAGING): Staging {
  return cardList.reduce(stageCard, from);
}

function preview(over: Partial<PreviewParams> & { staging: Staging; zone: readonly Card[] }) {
  return previewLayDown({
    melds: [],
    config: EAST_COAST,
    roundNumber: 1,
    isDown: false,
    inFoot: false,
    footCount: 14,
    ...over,
  });
}

describe("staging a natural", () => {
  it("opens a group for its rank and focuses it", () => {
    const king = card("K");
    const staging = stageCard(EMPTY_STAGING, king);
    expect(staging.groups).toEqual([{ rank: "K", cardIds: [king.id] }]);
    expect(staging.focusedRank).toBe("K");
  });

  it("collects same-rank cards into one group", () => {
    const kings = cards("K", 3);
    expect(stageAll(kings).groups).toEqual([{ rank: "K", cardIds: kings.map((c) => c.id) }]);
  });

  it("keeps separate groups per rank and focuses the latest", () => {
    const king = card("K");
    const four = card("4");
    const staging = stageAll([king, four]);
    expect(staging.groups.map((g) => g.rank)).toEqual(["K", "4"]);
    expect(staging.focusedRank).toBe("4");
  });

  it("ignores a card already staged", () => {
    const king = card("K");
    expect(stagedCount(stageAll([king, king]))).toBe(1);
  });
});

describe("staging a wild", () => {
  it("attaches to the focused group", () => {
    // A wild has no rank of its own, so something has to say which book it is spent
    // on; the group the player was just building is that something.
    const kings = cards("K", 2);
    const wild = card("2");
    const staging = stageAll([...kings, wild]);
    expect(staging.groups).toEqual([{ rank: "K", cardIds: [kings[0].id, kings[1].id, wild.id] }]);
  });

  it("goes nowhere when no group is focused", () => {
    // Guessing which book to spend a wild on would be guessing at the only decision
    // a wild actually involves.
    expect(stageCard(EMPTY_STAGING, card("JOKER"))).toEqual(EMPTY_STAGING);
    expect(stageCard(EMPTY_STAGING, card("2"))).toEqual(EMPTY_STAGING);
  });

  it("follows the focus to a later group", () => {
    const king = card("K");
    const four = card("4");
    const wild = card("JOKER");
    const staging = stageAll([king, four, wild]);
    expect(staging.groups.find((g) => g.rank === "4")?.cardIds).toContain(wild.id);
    expect(staging.groups.find((g) => g.rank === "K")?.cardIds).not.toContain(wild.id);
  });

  it("can be aimed at a book already on the table", () => {
    // Extending a book of kings with a single wild: there is no natural king to open
    // a group, so focusing the rank has to be enough to give the wild a home.
    const wild = card("2");
    const staging = stageCard(focusGroup(EMPTY_STAGING, "K"), wild);
    expect(staging.groups).toEqual([{ rank: "K", cardIds: [wild.id] }]);
  });
});

describe("red threes", () => {
  it("cannot be staged at all", () => {
    // They can never be melded; the engine refuses them too.
    expect(stageCard(EMPTY_STAGING, card("3", "hearts"))).toEqual(EMPTY_STAGING);
    expect(stageCard(EMPTY_STAGING, card("3", "diamonds"))).toEqual(EMPTY_STAGING);
  });

  it("does not block a black three, which is meldable from the foot", () => {
    const black = card("3", "spades");
    expect(stagedIds(stageCard(EMPTY_STAGING, black)).has(black.id)).toBe(true);
  });
});

describe("unstaging", () => {
  it("takes one card back out", () => {
    const kings = cards("K", 3);
    const staging = unstageCard(stageAll(kings), kings[1].id);
    expect(staging.groups[0].cardIds).toEqual([kings[0].id, kings[2].id]);
  });

  it("drops a group left empty, and its focus with it", () => {
    const king = card("K");
    const staging = unstageCard(stageCard(EMPTY_STAGING, king), king.id);
    expect(staging).toEqual(EMPTY_STAGING);
  });

  it("keeps the focus when the group survives", () => {
    const kings = cards("K", 2);
    const staging = unstageCard(stageAll(kings), kings[0].id);
    expect(staging.focusedRank).toBe("K");
  });

  it("ignores a card that was never staged", () => {
    const staging = stageAll(cards("K", 2));
    expect(unstageCard(staging, "nope")).toEqual(staging);
  });
});

describe("retainCards", () => {
  it("returns the very same value when every staged card is still held", () => {
    const kings = cards("K", 2);
    const staging = stageAll(kings);
    expect(retainCards(staging, [...kings, card("9")])).toBe(staging);
  });

  it("drops a staged card that has left the zone", () => {
    const kings = cards("K", 3);
    const staging = retainCards(stageAll(kings), [kings[0], kings[2]]);
    expect(staging.groups[0].cardIds).toEqual([kings[0].id, kings[2].id]);
  });

  it("drops a group whose every card has gone, and its focus", () => {
    const kings = cards("K", 2);
    const fours = cards("4", 3);
    const staging = retainCards(stageAll([...kings, ...fours]), fours);
    expect(staging.groups.map((group) => group.rank)).toEqual(["4"]);
    expect(staging.focusedRank).toBe("4");
    expect(retainCards(stageAll(kings), [])).toEqual(EMPTY_STAGING);
  });
});

describe("toMeldPlays", () => {
  it("sends one play per group", () => {
    const kings = cards("K", 3);
    const fours = cards("4", 3);
    expect(toMeldPlays(stageAll([...kings, ...fours]))).toEqual([
      { rank: "K", cardIds: kings.map((c) => c.id) },
      { rank: "4", cardIds: fours.map((c) => c.id) },
    ]);
  });

  it("drops an empty group, which the engine would refuse", () => {
    expect(toMeldPlays(focusGroup(EMPTY_STAGING, "K"))).toEqual([]);
  });
});

describe("the running total", () => {
  it("adds up the card values of what is staged", () => {
    // Three kings at ten each under the East Coast scoring.
    const kings = cards("K", 3);
    const result = preview({ staging: stageAll(kings), zone: kings });
    expect(result.value).toBe(3 * EAST_COAST.scoring.tenToKing);
  });

  it("counts a newly completed book's bonus toward the minimum", () => {
    // The reducer adds it, so the preview must too, or a lay-down that clears the
    // minimum only with the bonus would look short of it.
    const aces = cards("A", 7, "spades");
    const result = preview({ staging: stageAll(aces), zone: aces });
    // Values come from the table's scoring config, not from numbers written here:
    // what is under test is that the preview sums them and adds the bonus the
    // reducer adds, not what an ace happens to be worth.
    expect(result.value).toBe(7 * EAST_COAST.scoring.ace + EAST_COAST.scoring.cleanBookBonus);
    expect(result.groups[0].kind).toBe("clean");
  });

  it("uses the dirty bonus for a book containing a wild", () => {
    const sixes = cards("6", 6);
    const wild = card("2");
    const zone = [...sixes, wild];
    const result = preview({ staging: stageAll(zone), zone });
    expect(result.groups[0].kind).toBe("dirty");
    expect(result.value).toBe(
      6 * EAST_COAST.scoring.fourToNine +
        EAST_COAST.scoring.two +
        EAST_COAST.scoring.dirtyBookBonus,
    );
  });

  it("awards no book bonus for a book that was already complete", () => {
    // `before < 7` in the reducer: topping up an existing book earns nothing extra.
    const existing = cards("A", 7, "spades");
    const another = card("A", "hearts");
    const result = preview({
      staging: stageCard(EMPTY_STAGING, another),
      zone: [another],
      melds: [{ rank: "A", cards: existing }],
      isDown: true,
    });
    expect(result.value).toBe(EAST_COAST.scoring.ace);
  });

  it("reports the round's minimum, and none once already down", () => {
    const kings = cards("K", 3);
    expect(preview({ staging: stageAll(kings), zone: kings }).minimum).toBe(
      EAST_COAST.layDownMinimums[0],
    );
    expect(preview({ staging: stageAll(kings), zone: kings, isDown: true }).minimum).toBe(0);
  });
});

describe("whether it would be accepted", () => {
  it("refuses a lay-down below the minimum, in the engine's words", () => {
    const fours = cards("4", 3);
    const result = preview({ staging: stageAll(fours), zone: fours });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/below the round minimum of 60/);
  });

  it("accepts one that clears the minimum", () => {
    // Seven aces: 140 plus the clean-book bonus, comfortably over 60.
    const aces = cards("A", 7, "spades");
    const result = preview({ staging: stageAll(aces), zone: aces });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("refuses a pair, because a meld needs three", () => {
    const kings = cards("K", 2);
    const result = preview({ staging: stageAll(kings), zone: kings, isDown: true });
    expect(result.groups[0].problem).not.toBeNull();
    expect(result.ok).toBe(false);
  });

  it("accepts a single card added to a book already down", () => {
    // Extending is legal at any size; only a new meld needs three.
    const existing = cards("K", 3);
    const another = card("K", "hearts");
    const result = preview({
      staging: stageCard(EMPTY_STAGING, another),
      zone: [another],
      melds: [{ rank: "K", cards: existing }],
      isDown: true,
    });
    expect(result.ok).toBe(true);
    expect(result.groups[0].combinedSize).toBe(4);
  });

  it("enforces the variant's wild ratio through the engine", () => {
    // Two naturals and two wilds: legal West Coast, not East Coast. The preview must
    // follow the table's own rules rather than a rule of its own.
    const twoKings = cards("K", 2);
    const wilds = [card("2", "hearts"), card("2", "spades")];
    const zone = [...twoKings, ...wilds];
    const east = preview({ staging: stageAll(zone), zone, isDown: true });
    const west = preview({ staging: stageAll(zone), zone, isDown: true, config: WEST_COAST });
    expect(east.groups[0].problem).not.toBeNull();
    expect(west.groups[0].problem).toBeNull();
  });

  it("refuses black threes from the hand", () => {
    const threes = cards("3", 7, "spades");
    const result = preview({ staging: stageAll(threes), zone: threes, isDown: true });
    expect(result.problems.join(" ")).toMatch(/only be melded from the foot/);
  });

  it("refuses fewer than seven black threes even from the foot", () => {
    const threes = cards("3", 3, "spades");
    const result = preview({
      staging: stageAll(threes),
      zone: threes,
      isDown: true,
      inFoot: true,
    });
    expect(result.problems.join(" ")).toMatch(/book of seven or more/);
  });

  it("accepts seven black threes from the foot", () => {
    const threes = cards("3", 7, "spades");
    const result = preview({
      staging: stageAll(threes),
      zone: threes,
      isDown: true,
      inFoot: true,
    });
    expect(result.groups[0].problem).toBeNull();
  });

  it("says when nothing is staged", () => {
    expect(preview({ staging: EMPTY_STAGING, zone: [] }).ok).toBe(false);
    expect(preview({ staging: EMPTY_STAGING, zone: [] }).problems).toContain(
      "nothing is staged yet",
    );
  });

  it("refuses a group whose naturals do not match its declared rank", () => {
    // Reachable by focusing one rank and then staging a natural of another into it.
    const staging: Staging = {
      groups: [{ rank: "K", cardIds: ["x1", "x2", "x3"] }],
      focusedRank: "K",
    };
    const zone = [
      { id: "x1", rank: "4" as Rank, suit: "clubs" as Suit },
      { id: "x2", rank: "4" as Rank, suit: "hearts" as Suit },
      { id: "x3", rank: "4" as Rank, suit: "spades" as Suit },
    ];
    const result = preview({ staging, zone, isDown: true });
    expect(result.problems.join(" ")).toMatch(/declared as rank K but its natural cards are 4/);
  });
});

describe("the Marva exception", () => {
  it("waives the minimum when the lay-down empties the hand", () => {
    // The house rule: going out of the hand straight into the foot is allowed to
    // fall short. Mirrored here so the preview does not refuse what the reducer
    // would accept.
    const fours = cards("4", 3);
    const result = preview({
      staging: stageAll(fours),
      zone: fours,
      config: { ...EAST_COAST, marvaRule: true },
      footCount: 14,
    });
    expect(result.marvaWaived).toBe(true);
    expect(result.emptiesHand).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("does not waive it when cards would be left in hand", () => {
    const fours = cards("4", 3);
    const spare = card("9");
    const result = preview({
      staging: stageAll(fours),
      zone: [...fours, spare],
      config: { ...EAST_COAST, marvaRule: true },
    });
    expect(result.marvaWaived).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("does not waive it at a table with the rule off", () => {
    const fours = cards("4", 3);
    const result = preview({
      staging: stageAll(fours),
      zone: fours,
      config: { ...EAST_COAST, marvaRule: false },
    });
    expect(result.marvaWaived).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("is not claimed when the lay-down already clears the minimum", () => {
    // Nothing to waive, so saying so would be misleading.
    const aces = cards("A", 7, "spades");
    const result = preview({
      staging: stageAll(aces),
      zone: aces,
      config: { ...EAST_COAST, marvaRule: true },
    });
    expect(result.marvaWaived).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("does not apply when there is no foot to go into", () => {
    // Mirrors the reducer's own `foot.length > 0`: emptying the hand only means
    // something when there is a foot waiting. With none, this is just running out of
    // cards, and the minimum still stands.
    const fours = cards("4", 3);
    const result = preview({
      staging: stageAll(fours),
      zone: fours,
      config: { ...EAST_COAST, marvaRule: true },
      footCount: 0,
    });
    expect(result.emptiesHand).toBe(false);
    expect(result.marvaWaived).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("does not apply from the foot, where there is no hand to empty", () => {
    const fours = cards("4", 3);
    const result = preview({
      staging: stageAll(fours),
      zone: fours,
      config: { ...EAST_COAST, marvaRule: true },
      inFoot: true,
      footCount: 3,
    });
    expect(result.emptiesHand).toBe(false);
    expect(result.marvaWaived).toBe(false);
  });
});

describe("the take-pile obligation", () => {
  it("is settled when nothing is owed", () => {
    expect(settlesObligation(EMPTY_STAGING, [])).toBe(true);
  });

  it("needs one of the owed cards staged", () => {
    // Taking the pile owes at least one of the taken cards to a meld before the turn
    // can end, so the client can say a discard will be refused before it is tried.
    const owed = card("K");
    const other = card("4");
    expect(settlesObligation(stageAll([other, other]), [owed.id])).toBe(false);
    expect(settlesObligation(stageAll([owed]), [owed.id])).toBe(true);
  });

  it("is settled by any one of several owed cards", () => {
    const first = card("K");
    const second = card("4");
    expect(settlesObligation(stageAll([second]), [first.id, second.id])).toBe(true);
  });
});

describe("stagedIds and stagedCount", () => {
  it("report everything staged across groups", () => {
    const kings = cards("K", 2);
    const fours = cards("4", 3);
    const staging = stageAll([...kings, ...fours]);
    expect(stagedCount(staging)).toBe(5);
    expect([...stagedIds(staging)].sort()).toEqual([...kings, ...fours].map((c) => c.id).sort());
  });

  it("are empty for empty staging", () => {
    expect(stagedCount(EMPTY_STAGING)).toBe(0);
    expect(stagedIds(EMPTY_STAGING).size).toBe(0);
  });
});

describe("a focused group with nothing in it yet", () => {
  it("is incomplete rather than classified, and raises no problem", () => {
    // Reached in the real interface by pressing "Add to Ks" before choosing a wild:
    // the group exists so the wild has somewhere to go, but holds nothing yet.
    const result = preview({ staging: focusGroup(EMPTY_STAGING, "K"), zone: [] });
    expect(result.groups[0].kind).toBe("incomplete");
    expect(result.groups[0].combinedSize).toBe(0);
    expect(result.groups[0].problem).toBeNull();
    // Still not submittable: there is nothing to submit.
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("nothing is staged yet");
  });

  it("classifies against the book already on the table", () => {
    const existing = cards("K", 7);
    const result = preview({
      staging: focusGroup(EMPTY_STAGING, "K"),
      zone: [],
      melds: [{ rank: "K", cards: existing }],
      isDown: true,
    });
    expect(result.groups[0].combinedSize).toBe(7);
    expect(result.groups[0].kind).toBe("clean");
  });
});

describe("the defensive red-three guard in a group", () => {
  it("refuses one that reached a group by some other route", () => {
    // `stageCard` will not put a red three in a group, so this is unreachable through
    // the interface. It mirrors the reducer's own check so the preview cannot bless a
    // lay-down the server refuses, however the staging was built.
    const three = card("3", "hearts");
    const staging: Staging = {
      groups: [{ rank: "3", cardIds: [three.id] }],
      focusedRank: "3",
    };
    const result = preview({ staging, zone: [three], isDown: true });
    expect(result.groups[0].problem).toBe("red threes can never be melded");
    expect(result.ok).toBe(false);
  });
});
