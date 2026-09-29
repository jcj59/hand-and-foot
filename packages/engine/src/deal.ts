import type { Card, GameState, PlayerState, RulesConfig } from "@hf/shared";
import { buildShoe } from "./deck";
import { prng, shuffle } from "./rng";

/**
 * Produce the initial state of a round: build and shuffle the shoe, deal a hand
 * and a foot to each player, optionally flip one card to start the discard pile,
 * and leave the remainder as the stock. Deterministic in the seed and the round.
 *
 * Each round shuffles from its own seed, derived from the match's, so a match is
 * still reproducible from one number; round 1 uses the match seed itself, so every
 * game recorded before there were rounds deals exactly as it did. The first turn
 * passes one seat to the left each round, as the deal does at a real table.
 */
export function deal(
  playerCount: number,
  config: RulesConfig,
  seed: number,
  roundNumber = 1,
): GameState {
  const rng = prng(roundSeed(seed, roundNumber));
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
    roundNumber,
    players,
    currentSeat: (roundNumber - 1) % playerCount,
    phase: "draw",
    stock,
    discard,
  };
}

/**
 * The shuffle seed for one round of a match. Round 1 is the match seed, unchanged;
 * later rounds step by a large odd number so that no two rounds of any match share
 * a shuffle, and none collides with the stock reshuffle, which offsets by one.
 */
export function roundSeed(seed: number, roundNumber: number): number {
  return (seed + (roundNumber - 1) * 1_000_003) >>> 0;
}
