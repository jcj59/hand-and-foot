/**
 * The scenario library: every situation worth being able to watch, ordinary and
 * edge case. Each one is a single entry; `library.test.ts` plays every one of them
 * headlessly and checks that it still shows what it says it does.
 *
 * Hands are written out only where the situation depends on them. Everyone else is
 * dealt from the rest of a real shoe, so the table looks like a game in progress.
 */
import { EAST_COAST } from "@hf/shared";
import type { Scenario } from "./scenario";
import { autoTurns, autoUntil, discard, draw, meld, moment, takeBack, takePile } from "./script";

const NAMES = ["Ana", "Ben", "Cal"] as const;

/** The books East Coast needs to go out: one clean, two dirty. */
const GO_OUT_BOOKS = {
  K: "KC KD KH KS KC KD KH",
  Q: "QC QD QH QS QC QD 2C",
  J: "JC JD JH JS JC JD JK",
} as const;

/** Getting down in round `round`, exactly as that round's minimum asks. */
function getDown(
  round: number,
  hand: string,
  melds: Record<string, string>,
  how: string,
): Scenario {
  const minimum = EAST_COAST.layDownMinimums[round - 1]!;
  return {
    id: `getdown-round-${round}`,
    title: `Getting down in round ${round}`,
    description: `Round ${round} needs ${minimum} points to get down. ${how}`,
    config: EAST_COAST,
    setup: { seed: 100 + round, roundNumber: round, seats: [{ hand }, {}, {}] },
    names: NAMES,
    script: [
      draw(),
      meld(melds),
      moment("getdown", `Ana gets down in round ${round} (minimum ${minimum})`),
      discard(),
      autoTurns(2),
    ],
  };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "ordinary-turns",
    title: "Ordinary turns",
    description:
      "Draw, meld, discard: Ana gets down with kings and aces, then everyone plays a few plain turns.",
    config: EAST_COAST,
    setup: {
      seed: 1,
      seats: [{ hand: "KC KD KH AC AD AH 7C 7D 9S 10H 4D 6C JS QH" }, {}, {}],
      stockTop: "5C 8D 9H KS",
    },
    names: NAMES,
    script: [
      draw(),
      meld({ K: "KC KD KH", A: "AC AD AH" }),
      moment("getdown", "Ana lays down kings and aces"),
      discard("9S"),
      draw(),
      discard(),
      draw(),
      discard(),
      draw(),
      meld({ K: "KS" }),
      moment("layoff", "Ana adds a king to her kings"),
      discard("4D"),
      autoTurns(3),
    ],
  },
  getDown(
    1,
    "KC KD KH QC QD QS 4C 6D 8H 9S 10C JD 5H 7S",
    { K: "KC KD KH", Q: "QC QD QS" },
    "Three kings and three queens make exactly 60.",
  ),
  getDown(
    2,
    "KC KD KH QC QD QS AC AD AH 4C 6D 8H 9S 7S",
    { K: "KC KD KH", Q: "QC QD QS", A: "AC AD AH" },
    "Kings, queens and aces make 105.",
  ),
  getDown(
    3,
    "AC AD AH AS KC KD KH JC JD JS 4C 6D 8H 9S",
    { A: "AC AD AH AS", K: "KC KD KH", J: "JC JD JS" },
    "Four aces, three kings and three jacks make exactly 120.",
  ),
  getDown(
    4,
    "5C 5D 5H 5S 5C 5D 5H 4C 6D 8H 9S 10C JD 7S",
    { "5": "5C 5D 5H 5S 5C 5D 5H" },
    "Seven fives are only 35 in cards, but a clean book adds 500, which counts toward the minimum.",
  ),
  {
    id: "marva",
    title: "The Marva rule",
    description:
      "Under the Marva rule, which both presets play, a lay-down that empties the hand gets down whatever its value: Ana melds four fives, worth 20 against a minimum of 60, picks up her foot, and the table celebrates.",
    config: EAST_COAST,
    setup: { seed: 7, seats: [{ hand: "5C 5D 5H" }, {}, {}], stockTop: "5S" },
    names: NAMES,
    script: [
      draw(),
      meld({ "5": "5C 5D 5H 5S" }),
      moment("getdown", "Marva: Ana gets down with 20 by melding her whole hand"),
      discard(),
      autoTurns(3),
    ],
  },
  {
    id: "pile-natural-pair",
    title: "Taking the pile with a natural pair",
    description:
      "Ana holds two nines and a nine is on top of the pile, so she takes the whole pile — and owes a play from it before she may discard.",
    config: EAST_COAST,
    setup: {
      seed: 2,
      seats: [{ melds: { Q: "QC QD QH" }, hand: "9C 9D 4C 6D 8H 10S 5C 7H JD KS AC" }, {}, {}],
      discard: "4H 6S JC 9H",
    },
    names: NAMES,
    script: [
      takePile(),
      moment("taken", "Ana takes the pile; the cards from it are ringed until she plays one"),
      meld({ "9": "9C 9D 9H" }),
      moment("settled", "Playing a pile card settles what she owed"),
      discard(),
      autoTurns(2),
    ],
  },
  {
    id: "pile-pair-wild",
    title: "Taking the pile with a pair and a wild",
    description:
      "Ana has one eight and a two. With the eight on the pile that is a pair plus a wild, which is enough to take it.",
    config: EAST_COAST,
    setup: {
      seed: 3,
      seats: [{ melds: { Q: "QC QD QH" }, hand: "8C 2S 4C 6D 10S 5C 7H JD KS AC" }, {}, {}],
      discard: "4H 6S 8H",
    },
    names: NAMES,
    script: [
      takePile(),
      moment("taken", "Ana takes the pile with one eight and a wild"),
      meld({ "8": "8C 8H 2S" }),
      discard(),
      autoTurns(2),
    ],
  },
  {
    id: "pile-extend-meld",
    title: "Taking the pile to extend a meld",
    description:
      "Ana is down with jacks; the jack on the pile goes straight onto them, so she can take the pile without holding any pair.",
    config: EAST_COAST,
    setup: {
      seed: 4,
      seats: [{ melds: { J: "JC JD JH" }, hand: "4C 6D 10S 5C 7H KD AC" }, {}, {}],
      discard: "4H 6S 9C JS",
    },
    names: NAMES,
    script: [
      takePile(),
      moment("taken", "Ana takes the pile for one jack"),
      meld({ J: "JS" }),
      discard(),
      autoTurns(2),
    ],
  },
  {
    id: "threes",
    title: "Red and black threes",
    description:
      "Ben was dealt a red three and draws another. Red threes can never be melded and cost 500 each if still held when the round ends; a black three is only a discard. Cal goes out, and Ben pays for both.",
    config: EAST_COAST,
    setup: {
      seed: 5,
      seats: [
        {},
        { hand: "3H 4C 6D 8H 9S 10C JD QH KS AC 5D 7S 3S" },
        { inFoot: true, melds: { ...GO_OUT_BOOKS, "6": "6S 6H 6C" }, foot: "6D" },
      ],
      stockTop: "9D 3D 4S",
    },
    names: NAMES,
    watch: 1,
    script: [
      draw(),
      discard(),
      draw(),
      moment("drawn", "Ben draws a second red three"),
      discard("3S"),
      moment("black", "Ben throws a black three, and keeps both red ones"),
      draw(),
      meld({ "6": "6D" }),
      discard("4S"),
      moment("out", "Cal goes out; every red three still held costs 500"),
    ],
  },
  {
    id: "black-three-book",
    title: "A book of black threes to go out",
    description:
      "Black threes can be melded only from the foot, and only as a book of seven. Ana melds hers and goes out with her last discard.",
    config: EAST_COAST,
    setup: {
      seed: 6,
      seats: [{ inFoot: true, melds: GO_OUT_BOOKS, foot: "3C 3S 3C 3S 3C 3S 3C" }, {}, {}],
      stockTop: "8C",
    },
    names: NAMES,
    script: [
      draw(),
      meld({ "3": "3C 3S 3C 3S 3C 3S 3C" }),
      moment("book", "Ana melds seven black threes"),
      discard("8C"),
    ],
  },
  {
    id: "foot-with-discard",
    title: "Picking up the foot after a discard",
    description:
      "Ana discards her last hand card. The foot waits until her next turn, when she picks it up instead of drawing.",
    config: EAST_COAST,
    setup: { seed: 8, seats: [{ melds: { K: "KC KD KH" }, hand: "9C" }, {}, {}], stockTop: "KS" },
    names: NAMES,
    script: [
      draw(),
      meld({ K: "KS" }),
      discard("9C"),
      moment("pending", "Ana's hand is empty; her foot waits for her next turn"),
      autoTurns(2),
      discard(),
      autoTurns(2),
    ],
  },
  {
    id: "foot-without-discard",
    title: "Picking up the foot by melding",
    description:
      "Ana melds every card in her hand, picks up her foot in the middle of the turn, and plays on from it.",
    config: EAST_COAST,
    setup: {
      seed: 9,
      seats: [{ melds: { K: "KC KD KH" }, hand: "KS 7C 7D" }, {}, {}],
      stockTop: "7H",
    },
    names: NAMES,
    script: [
      draw(),
      meld({ K: "KS", "7": "7C 7D 7H" }),
      moment("pickup", "Ana's hand is gone: she picks up her foot and keeps playing"),
      discard(),
      autoTurns(2),
    ],
  },
  {
    id: "wild-take-back",
    title: "A wild placed and taken back",
    description:
      "Ana puts a two on her eights, thinks better of it, takes it back, and puts it on her jacks instead — nothing is final until the discard.",
    config: EAST_COAST,
    setup: {
      seed: 10,
      seats: [
        { melds: { "8": "8C 8D 8H 8S", J: "JC JD JH JS" }, hand: "2C 4C 6D 10S 5C 9H" },
        {},
        {},
      ],
    },
    names: NAMES,
    script: [
      draw(),
      meld({ "8": "2C" }),
      moment("placed", "Ana puts the wild on her eights"),
      takeBack(),
      moment("taken-back", "She takes it back"),
      meld({ J: "2C" }),
      discard(),
      autoTurns(2),
    ],
  },
  {
    id: "shed-all",
    title: "Shedding every card, and digging back in",
    description:
      "Ana melds her last foot cards without the books to go out. The round goes on, she has no cards, and she draws each turn — until Cal discards a queen and she takes the pile with it.",
    config: EAST_COAST,
    setup: {
      seed: 11,
      seats: [
        { inFoot: true, melds: { K: "KC KD KH", Q: "QC QD QH" }, foot: "KS" },
        {},
        { hand: "QS 4C 6D 8H 9S 10C JD 5H 7S AC AD 4S" },
      ],
      stockTop: "QC 9C 6H 5D 8S 10D",
      discard: "4H 6S",
    },
    names: NAMES,
    script: [
      draw(),
      meld({ K: "KS", Q: "QC" }),
      moment("cardless", "Ana has shed every card, but without the books she has not gone out"),
      draw(),
      discard(),
      draw(),
      discard("QS"),
      draw(),
      discard("5D"),
      moment("drew", "With no cards, Ana draws one and throws it"),
      draw(),
      discard(),
      draw(),
      discard(),
      takePile(),
      moment("dig", "Ana takes the pile with Cal's queen and is back in the round"),
      meld({ Q: "QS" }),
      discard(),
      autoTurns(2),
    ],
  },
  {
    id: "go-out-final-lap",
    title: "Going out, and the final lap",
    description:
      "Ana melds her last cards while holding the books, which goes out without a discard. Everyone else gets one last turn before the round is scored.",
    config: EAST_COAST,
    setup: {
      seed: 12,
      seats: [{ inFoot: true, melds: { ...GO_OUT_BOOKS, "7": "7S 7H 7C" }, foot: "7C 7D" }, {}, {}],
      stockTop: "7S",
    },
    names: NAMES,
    script: [
      draw(),
      meld({ "7": "7C 7D 7S" }),
      moment("out", "Ana goes out by melding her last cards"),
      autoTurns(2),
    ],
  },
  {
    id: "stock-reshuffle",
    title: "The stock runs out",
    description:
      "Two cards are left in the stock. When it is empty, the discard pile below its top card is shuffled into a new stock and play goes on.",
    config: EAST_COAST,
    setup: { seed: 13, seats: [{}, {}, {}], stockSize: 2 },
    names: NAMES,
    script: [
      draw(),
      discard(),
      draw(),
      moment("empty", "Ben draws the last card of the stock"),
      discard(),
      draw(),
      moment("reshuffled", "Cal's draw reshuffles the pile into a new stock"),
      discard(),
      autoTurns(3),
    ],
  },
  {
    id: "grabby-pants",
    title: "Grabby Pants",
    description:
      "Ana takes the pile three times running and becomes Grabby Pants. Ben then takes it four times running — Ana's draws in between do not break his run — and the title is his.",
    config: EAST_COAST,
    setup: {
      seed: 14,
      seats: [
        { melds: { "5": "5C 5D 5S" }, hand: "9C 9C 9D 9D 9H 9H QC KD 4H 6S 10C AC" },
        { melds: { "9": "9S 9S 9C" }, hand: "5H 5H 5H 5H 5S 5S 5S QD KH 4C 6D 10D" },
        {},
      ],
      discard: "8C 5D",
    },
    names: NAMES,
    script: [
      takePile(),
      meld({ "5": "5D" }),
      discard("9C"),
      draw(),
      discard("5H"),
      draw(),
      discard(),
      takePile(),
      meld({ "5": "5H" }),
      discard("9C"),
      draw(),
      discard("5H"),
      draw(),
      discard(),
      takePile(),
      moment("earned", "Ana takes the pile a third time running"),
      meld({ "5": "5H" }),
      discard("9D"),
      ...[1, 2, 3, 4].flatMap((n) => [
        takePile(),
        ...(n === 4 ? [moment("taken", "Ben's fourth pile in a row beats Ana's three")] : []),
        meld({ "9": n < 3 ? "9D" : "9H" }),
        discard(n === 1 ? "5H" : "5S"),
        draw(),
        discard(),
        ...(n < 4 ? [draw(), discard(n < 2 ? "9D" : "9H")] : []),
      ]),
    ],
  },
  {
    id: "match",
    title: "A whole match",
    description:
      "Four rounds at 60, 90, 120 and 150, played by the scenario autopilot: the next round dealt each time, the first turn moving on a seat, and the match scored at the end.",
    config: EAST_COAST,
    setup: { seed: 2, playerCount: 2 },
    names: ["Ana", "Ben"],
    script: [autoUntil("match")],
  },
];

/** A scenario by its id. */
export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
