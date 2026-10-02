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
 * goes to `firstSeat` in round 1 and passes one seat to the left each round after,
 * as the deal does at a real table. It defaults to seat 0, which is what every
 * game recorded before the first player was chosen at random assumes.
 */
export function deal(
  playerCount: number,
  config: RulesConfig,
  seed: number,
  roundNumber = 1,
  firstSeat = 0,
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
    currentSeat: (firstSeat + roundNumber - 1) % playerCount,
    phase: "draw",
    stock,
    discard,
    // Left out at seat 0, so a state dealt the old way is the same value it was.
    ...(firstSeat !== 0 ? { firstSeat } : {}),
  };
}

/**
 * Offsets the match seed for the first-seat choice, so that it is not simply the
 * shuffle's own first draw. Any fixed odd constant would do; this is the golden
 * ratio's, the usual one for decorrelating a seed.
 */
const FIRST_SEAT_SALT = 0x9e3779b9;

/**
 * Who takes the first turn of a new match: a seat chosen at random, but derived
 * from the match seed, so the engine stays pure and a match is still reproducible
 * from its seed. Not applied by `deal` itself — the caller records the seat it
 * dealt with, because a match recorded before this choice existed started at seat
 * 0 whatever its seed, and must go on replaying that way.
 */
export function firstSeatFor(seed: number, playerCount: number): number {
  return Math.floor(prng((seed ^ FIRST_SEAT_SALT) >>> 0)() * playerCount);
}

/**
 * The shuffle seed for one round of a match. Round 1 is the match seed, unchanged;
 * later rounds step by a large odd number so that no two rounds of any match share
 * a shuffle, and none collides with the stock reshuffle, which offsets by one.
 */
export function roundSeed(seed: number, roundNumber: number): number {
  return (seed + (roundNumber - 1) * 1_000_003) >>> 0;
}
