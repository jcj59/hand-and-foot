import type { Card, GameState, PlayerState, RulesConfig } from "@hf/shared";
import { buildShoe } from "./deck";
import { prng, shuffle } from "./rng";

/**
 * Produce the initial state of a round: build and shuffle the shoe, deal a hand
 * and a foot to each player, optionally flip one card to start the discard pile,
 * and leave the remainder as the stock. Deterministic in the seed.
 */
export function deal(playerCount: number, config: RulesConfig, seed: number): GameState {
  const rng = prng(seed);
  const shoe = shuffle(buildShoe(playerCount, config.extraDecks), rng);

  let next = 0;
  const take = (count: number): Card[] => {
    const slice = shoe.slice(next, next + count);
    next += count;
    return slice;
  };

  const players: PlayerState[] = [];
  for (let seat = 0; seat < playerCount; seat++) {
    players.push({
      hand: take(config.handSize),
      foot: take(config.footSize),
      melds: [],
      isDown: false,
      inFoot: false,
      footPending: false,
    });
  }

  const discard: Card[] = config.initialDiscardFlip ? take(1) : [];
  const stock = shoe.slice(next);

  return {
    config,
    seed,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "draw",
    stock,
    discard,
  };
}
