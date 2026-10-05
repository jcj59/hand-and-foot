/**
 * The tutorial: short lessons, one idea each, played at the real table against a
 * computer player. Each lesson is an arranged position and a few steps; a step
 * asks the learner for one move, and is satisfied by the position that move
 * produces rather than by the exact cards, so any move that does what was asked
 * counts. A move that does something else is not played: the learner is told why
 * and asked again, since the point of a lesson is the move it teaches.
 *
 * Pure, like the rest of the scenario library, so every lesson can be played
 * through in CI by its own solution and a lesson that stops working fails the
 * build by name.
 */
import {
  EAST_COAST,
  isRedThree,
  isWild,
  type Action,
  type GameState,
  type RulesConfig,
} from "@hf/shared";
import { arrange, type TableSpec } from "./arrange";

export interface LessonStep {
  /** What to do, said to the learner. */
  readonly ask: string;
  /** Whether a move did what was asked, judged by the position before and after it. */
  readonly done: (before: GameState, action: Action, after: GameState) => boolean;
  /** Said when a move was not the one asked for. */
  readonly hint: string;
}

export interface Lesson {
  readonly id: string;
  readonly title: string;
  /** The idea, in a sentence or two, before the first step. */
  readonly intro: string;
  readonly config: RulesConfig;
  readonly table: TableSpec;
  readonly steps: readonly LessonStep[];
  /** Said when the last step is done. */
  readonly outro: string;
}

/** The learner's seat; the other is the computer player's. */
export const LEARNER = 0;

/** The opponent's name in every lesson. */
export const TUTOR_NAMES = ["You", "Robo Rita"] as const;

const me = (state: GameState) => state.players[LEARNER]!;

const drew: LessonStep["done"] = (_b, action) => action.type === "draw";
const discarded: LessonStep["done"] = (_b, action) => action.type === "discard";

const discardStep = (
  ask = "Now end your turn by discarding a card you do not need.",
): LessonStep => ({
  ask,
  done: discarded,
  hint: "End the turn with a discard: pick a card and choose Discard.",
});

/** The books East Coast needs to go out: one clean, two dirty. */
const GO_OUT_BOOKS = {
  K: "KC KD KH KS KC KD KH",
  Q: "QC QD QH QS QC QD 2C",
  J: "JC JD JH JS JC JD JK",
} as const;

export const LESSONS: readonly Lesson[] = [
  {
    id: "turn",
    title: "A turn",
    intro:
      "Every turn has two halves: take a card, then, after any melding, give one back. Start by drawing from the stock.",
    config: EAST_COAST,
    table: {
      seed: 1,
      seats: [{ hand: "4C 5D 6H 7S 8C 9D 10H JS QC KD AS 4H 9C 6S" }, {}],
      discard: "3S",
    },
    steps: [
      {
        ask: "Click the stock to draw a card.",
        done: drew,
        hint: "Draw from the stock this time — the stack of face-down cards.",
      },
      discardStep("Now discard a card to end your turn. Any card will do."),
    ],
    outro: "That is a whole turn: draw, then discard. The computer player takes its turn next.",
  },
  {
    id: "getting-down",
    title: "Getting down",
    intro:
      "Your first melds of a round must be worth enough points together. In round one that is 60. Kings are worth 10 each and aces 15.",
    config: EAST_COAST,
    table: {
      seed: 2,
      seats: [{ hand: "KC KD KH AS AH AD 4C 6D 7S 9H 10C 5S 8D JC" }, {}],
      phase: "play",
    },
    steps: [
      {
        ask: "Meld your three kings and your three aces together: 30 + 45 = 75 points, over the 60 you need.",
        done: (_b, _a, after) => me(after).isDown,
        hint: "Stage the three kings and the three aces, then play them together — one meld alone is not worth 60.",
      },
      discardStep(),
    ],
    outro: "You are down. From now on, any meld you can make can be played, whatever it is worth.",
  },
  {
    id: "melds",
    title: "Adding to melds",
    intro:
      "Once you are down you can add to your melds and start new ones. A meld of seven is a book — the big points come from books.",
    config: EAST_COAST,
    table: {
      seed: 3,
      seats: [{ melds: { K: "KC KD KH" }, hand: "KS 7C 7D 7H 4S 9D 10C" }, {}],
      phase: "play",
    },
    steps: [
      {
        ask: "Add your king to your kings, and make a new meld of your three sevens.",
        done: (_b, _a, after) => {
          const melds = me(after).melds;
          return (
            (melds.find((m) => m.rank === "K")?.cards.length ?? 0) >= 4 &&
            melds.some((m) => m.rank === "7")
          );
        },
        hint: "Put the king on your kings and the three sevens in a meld of their own, in one play.",
      },
      discardStep(),
    ],
    outro: "Keep adding to a meld until it is seven cards: then it is a book.",
  },
  {
    id: "pile",
    title: "Taking the pile",
    intro:
      "Instead of drawing you can take the whole discard pile — if you can play one of its cards at once. The queen on top goes with the two queens in your hand.",
    config: EAST_COAST,
    table: {
      seed: 4,
      seats: [{ melds: { K: "KC KD KH" }, hand: "QC QD 4S 6H 9D 10C 8S" }, {}],
      discard: "5H 7C QH",
    },
    steps: [
      {
        ask: "Take the pile.",
        done: (_b, action) => action.type === "takePile",
        hint: "Click the discard pile to take all of it.",
      },
      {
        ask: "Now meld the queen you took with your two queens. You must play a card from the pile before you discard.",
        done: (_b, _a, after) =>
          me(after).melds.some((m) => m.rank === "Q") && (me(after).pickedUp ?? []).length === 0,
        hint: "Meld the three queens — the one from the pile and your two.",
      },
      discardStep(),
    ],
    outro: "The pile was yours, every card of it. A big pile can turn a round.",
  },
  {
    id: "wilds",
    title: "Wild cards",
    intro:
      "Twos and jokers are wild: they stand in for any rank in a meld. At this table a meld must always have more natural cards than wilds.",
    config: EAST_COAST,
    table: {
      seed: 5,
      seats: [{ melds: { K: "KC KD KH" }, hand: "7C 7D 2H 4S 9D 10C 8S" }, {}],
      phase: "play",
    },
    steps: [
      {
        ask: "Make a meld of sevens from your two sevens and the two (a wild).",
        done: (_b, _a, after) =>
          me(after).melds.some((m) => m.rank === "7" && m.cards.some((c) => isWild(c.rank))),
        hint: "Stage both sevens, then the two: a wild joins the meld you have selected.",
      },
      discardStep(),
    ],
    outro: "A book with a wild in it is dirty; one without is clean, and worth more.",
  },
  {
    id: "threes",
    title: "Threes",
    intro:
      "Red threes can never be melded, and one left in your hand at the end of a round costs you 500 points. Get rid of it.",
    config: EAST_COAST,
    table: {
      seed: 6,
      seats: [{ melds: { K: "KC KD KH" }, hand: "3H 4S 9D 10C 8S 6C" }, {}],
      phase: "play",
    },
    steps: [
      {
        ask: "Discard the red three.",
        done: (before, action) =>
          action.type === "discard" &&
          me(before).hand.some((c) => c.id === action.cardId && isRedThree(c)),
        hint: "Discard the three of hearts — it is the card that would cost you most.",
      },
    ],
    outro: "Black threes are different: they meld only from your foot, as a book of seven.",
  },
  {
    id: "foot",
    title: "The foot",
    intro:
      "When your hand is empty you pick up your foot, the second pile of cards dealt to you. Empty your hand by melding and you pick it up at once.",
    config: EAST_COAST,
    table: {
      seed: 7,
      seats: [{ melds: { K: "KC KD KH" }, hand: "8C 8D 8H" }, {}],
      phase: "play",
    },
    steps: [
      {
        ask: "Meld your three eights. Your hand will be empty, and your foot is yours.",
        done: (_b, _a, after) => me(after).inFoot,
        hint: "Meld all three eights together.",
      },
      discardStep("You are playing from your foot now. Discard a card to end the turn."),
    ],
    outro: "From your foot you can go out — once you have the books.",
  },
  {
    id: "going-out",
    title: "Going out",
    intro:
      "To go out you must be in your foot with one clean book and two dirty ones down. Then play your last card, and the round is over.",
    config: EAST_COAST,
    table: {
      seed: 8,
      seats: [{ inFoot: true, melds: GO_OUT_BOOKS, foot: "5C 5D 5H 9S" }, {}],
      phase: "play",
    },
    steps: [
      {
        ask: "Meld your three fives.",
        done: (_b, _a, after) => me(after).melds.some((m) => m.rank === "5"),
        hint: "Meld the three fives together.",
      },
      {
        ask: "Now discard your last card, the nine, to go out.",
        done: (_b, _a, after) => after.wentOutSeat === LEARNER,
        hint: "Discard the nine of spades: it is your last card.",
      },
    ],
    outro: "You went out: 100 points for it, and everyone else is caught holding their cards.",
  },
];

/** A lesson by id. */
export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** Where a lesson starts: its arranged table, the learner's turn. */
export function lessonStart(lesson: Lesson): GameState {
  return arrange({ ...lesson.table, currentSeat: LEARNER }, lesson.config);
}
