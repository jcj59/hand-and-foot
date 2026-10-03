/**
 * How to play, in words, for one table's rules.
 *
 * Every number a player could get wrong comes from the config — the hand and foot
 * sizes, the decks, the minimums, the wild ratio, the books going out takes, every
 * card's value — so a table's rules page describes that table, custom rules and
 * all, rather than the game in general. Pure, so the page and its tests read the
 * same words. The rules it states are the engine's, as settled in `CLAUDE.md`.
 */
import type { RulesConfig } from "@hf/shared";

export interface RulesSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** The sections of the page, in the order a new player needs them. */
export function howToPlay(config: RulesConfig): readonly RulesSection[] {
  const s = config.scoring;
  const minimums = config.layDownMinimums;
  const books = [
    ...(config.goOutCleanBooks > 0 ? [count(config.goOutCleanBooks, "clean book")] : []),
    ...(config.goOutDirtyBooks > 0 ? [count(config.goOutDirtyBooks, "dirty book")] : []),
  ];
  const ratio =
    config.wildRatio === "naturals-exceed-wilds"
      ? "a meld must always have more natural cards than wilds (three naturals carry at most two wilds)"
      : "a meld may have as many wilds as naturals, but never more";

  return [
    {
      id: "objective",
      title: "The aim",
      paragraphs: [
        `Score the most points over ${count(config.rounds, "round")}. Points come from the cards you meld, above all from books — melds of seven or more — and from going out first. Cards still in your hand or foot when a round ends count against you.`,
      ],
    },
    {
      id: "deal",
      title: "The deal",
      paragraphs: [
        `Each player is dealt a hand of ${config.handSize} cards and, face down beside it, a foot of ${config.footSize}. You play from your hand first and pick up your foot once the hand is gone.`,
        `The shoe has one deck for each player${config.extraDecks > 0 ? `, plus ${count(config.extraDecks, "extra deck")}` : ""}, jokers included. ${config.initialDiscardFlip ? "One card is turned up to start the discard pile; the rest are the stock." : "The rest are the stock; the discard pile starts empty."}`,
      ],
    },
    {
      id: "turn",
      title: "A turn",
      paragraphs: [
        "Draw one card from the stock, or take the whole discard pile (see below). Then meld whatever you can and want to, and end your turn by discarding one card.",
        "Melds you play this turn can be taken back until you discard — or until you pick up your foot, which makes them final. A player who has played every card ends the turn without a discard.",
        config.stockExhaustion === "reshuffle"
          ? "When the stock runs out, the discard pile below its top card is shuffled into a new stock."
          : "When the stock runs out, the round ends.",
      ],
    },
    {
      id: "melds",
      title: "Melds and books",
      paragraphs: [
        "A meld is three or more cards of one rank; there are no runs. You keep one meld per rank and add to it as you go.",
        "A meld of seven or more is a book. A book with no wilds is clean; one with any wild is dirty.",
      ],
    },
    {
      id: "wilds",
      title: "Wild cards",
      paragraphs: [
        `Twos and jokers are wild and can stand in for any rank in a meld, but ${ratio}. A meld can never be made of wilds alone.`,
      ],
    },
    {
      id: "threes",
      title: "Threes",
      paragraphs: [
        `Red threes can never be melded. One left in your hand or foot at the end of a round costs ${Math.abs(s.redThree)} points, so get rid of them by discarding.`,
        `Black threes can be melded only from your foot, as a book of seven or more (counted as dirty), with wilds allowed as for any meld. One left in your hand or foot costs ${s.blackThree}.`,
      ],
    },
    {
      id: "pile",
      title: "Taking the pile",
      paragraphs: [
        "Instead of drawing, you may take the whole discard pile — but only if you can play at least one of its cards at once, in a meld you make with your own cards (a pair of its rank, or one and a wild) or onto a meld you already have.",
        "If you are not down yet, that lay-down has to reach the round's minimum too. Before you discard, you must have played a card from the pile you took.",
      ],
    },
    {
      id: "getting-down",
      title: "Getting down",
      paragraphs: [
        minimums.length > 0
          ? `Your first melds of a round must be worth enough points together: ${list(
              minimums.map((m, i) => `${m} in round ${i + 1}`),
            )}${minimums.length < config.rounds ? ", and nothing after" : ""}.`
          : "Your first melds of a round can be worth any number of points.",
        `Card values count toward it, and so do books: a clean book adds ${s.cleanBookBonus} and a dirty one ${s.dirtyBookBonus}. Once you are down, any legal meld can be played.`,
      ],
    },
    {
      id: "marva",
      title: "The Marva rule",
      paragraphs: [
        config.marvaRule
          ? "This table plays the Marva rule: a first lay-down that empties your hand gets you down whatever it is worth, minimum or not."
          : "This table does not play the Marva rule: a first lay-down must reach the minimum even if it empties your hand.",
      ],
    },
    {
      id: "foot",
      title: "The foot",
      paragraphs: [
        "When your hand is empty you move on to your foot. Empty it by melding and you pick the foot up at once and keep playing; empty it with your discard and you pick the foot up at the start of your next turn, instead of drawing.",
      ],
    },
    {
      id: "going-out",
      title: "Going out",
      paragraphs: [
        `To go out you must be playing from your foot with ${books.length > 0 ? `at least ${list(books)}` : "any books at all, or none"} down, then play your last card. Going out with a discard ends the round at once; melding your last card instead gives every other player one last turn.`,
        "Playing your last card without those books is not going out: you keep playing, drawing a card each turn, until you can.",
      ],
    },
    {
      id: "scoring",
      title: "Scoring",
      paragraphs: [
        `Each card you have melded scores its value: jokers ${s.joker}, twos ${s.two}, aces ${s.ace}, tens to kings ${s.tenToKing}, fours to nines ${s.fourToNine}, black threes ${s.blackThree}.`,
        `Each clean book adds ${s.cleanBookBonus} and each dirty one ${s.dirtyBookBonus}. Going out adds ${s.goOutBonus}.`,
        `Every card left in your hand and foot is taken off at the same value; a red three left is ${signed(s.redThree)}.`,
      ],
    },
  ];
}
