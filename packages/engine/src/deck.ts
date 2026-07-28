import type { Card, Rank, Suit } from "@hf/shared";

const SUITS: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];

const NUMBER_AND_FACE_RANKS: readonly Rank[] = [
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
];

/**
 * One standard deck: 52 suited cards plus 2 jokers (54 total). `deckIndex`
 * disambiguates card ids so every card in a multi-deck shoe is unique.
 */
export function standardDeck(deckIndex: number): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of NUMBER_AND_FACE_RANKS) {
      cards.push({ id: `d${deckIndex}-${suit}-${rank}`, rank, suit });
    }
  }
  cards.push({ id: `d${deckIndex}-joker-0`, rank: "JOKER", suit: null });
  cards.push({ id: `d${deckIndex}-joker-1`, rank: "JOKER", suit: null });
  return cards;
}

/**
 * The full shoe for a game: (playerCount + extraDecks) standard decks. The deck
 * formula is configurable; the family default of one extra deck is the default here.
 */
export function buildShoe(playerCount: number, extraDecks = 1): Card[] {
  const numDecks = playerCount + extraDecks;
  const cards: Card[] = [];
  for (let i = 0; i < numDecks; i++) {
    cards.push(...standardDeck(i));
  }
  return cards;
}
