/**
 * A table set up by hand, for the situations a random deal will practically never
 * produce: a red three on top of the stock, a player one card from going out, a
 * stock about to run dry.
 *
 * Only the cards that make the situation are named. Everything else is the rest of
 * a real shoe — the same decks a deal would use, shuffled from the scenario's seed
 * — dealt to whatever was not specified, so the position holds every card exactly
 * once, as a real one would. That matters beyond tidiness: the engine's invariants
 * hold for it, and nothing on screen looks staged except what is meant to.
 */
import type { Card, GameState, Meld, Phase, Rank, RulesConfig } from "@hf/shared";
import { buildShoe, prng, shuffle } from "@hf/engine";
import { parseCards, takeCards } from "./cards";

export interface SeatSpec {
  /** Exactly these cards; dealt from the shoe to the configured size if omitted. */
  readonly hand?: string;
  /** Exactly these cards; dealt from the shoe to the configured size if omitted. */
  readonly foot?: string;
  /** Melds already on the table, by rank: `{ K: "KC KD KH" }`. Being down follows. */
  readonly melds?: Readonly<Partial<Record<Rank, string>>>;
  /** Playing from the foot. The hand is empty then, unless given. */
  readonly inFoot?: boolean;
}

export interface TableSpec {
  /** Shuffles the cards nobody named. */
  readonly seed: number;
  readonly seats: readonly SeatSpec[];
  /** The discard pile, bottom first; a single flipped card if omitted and the rules flip one. */
  readonly discard?: string;
  /** The next cards to be drawn, in order; the rest of the shoe follows them. */
  readonly stockTop?: string;
  /**
   * Leave only this many cards in the stock, as late in a round. The cards that
   * would have made it longer go under the discard pile, where they would be by then.
   */
  readonly stockSize?: number;
  readonly currentSeat?: number;
  readonly phase?: Phase;
  readonly roundNumber?: number;
}

/** Build the position a `TableSpec` describes, played under `config`. */
export function arrange(spec: TableSpec, config: RulesConfig): GameState {
  const playerCount = spec.seats.length;
  // Named cards come from the shoe in its built order, so the same spec always
  // names the same physical cards; the remainder is shuffled afterwards.
  let pool = buildShoe(playerCount, config.extraDecks);
  const claim = (text: string | undefined, where: string): Card[] => {
    if (!text) return [];
    const { taken, rest } = takeCards(pool, parseCards(text), `left in the shoe for ${where}`);
    pool = rest;
    return taken;
  };

  const named = spec.seats.map((seat, index) => ({
    hand: seat.hand === undefined ? null : claim(seat.hand, `seat ${index}'s hand`),
    foot: seat.foot === undefined ? null : claim(seat.foot, `seat ${index}'s foot`),
    melds: Object.entries(seat.melds ?? {}).map(([rank, text]): Meld => ({
      rank: rank as Rank,
      cards: claim(text, `seat ${index}'s ${rank}s`),
    })),
  }));
  const discard = claim(spec.discard, "the discard pile");
  const stockTop = claim(spec.stockTop, "the stock");

  let rest = shuffle(pool, prng(spec.seed));
  const deal = (count: number): Card[] => {
    if (count > rest.length) throw new Error(`the shoe ran out dealing ${count} cards`);
    const dealt = rest.slice(0, count);
    rest = rest.slice(count);
    return dealt;
  };

  const players = spec.seats.map((seat, index) => {
    const mine = named[index]!;
    const inFoot = seat.inFoot ?? false;
    return {
      // A player in the foot has no hand left, unless the scenario says otherwise.
      hand: mine.hand ?? (inFoot ? [] : deal(config.handSize)),
      foot: mine.foot ?? deal(config.footSize),
      melds: mine.melds,
      isDown: mine.melds.length > 0,
      inFoot,
      footPending: false,
    };
  });
  const pile = spec.discard !== undefined ? discard : config.initialDiscardFlip ? deal(1) : [];

  let stock = [...stockTop, ...rest];
  let buried: Card[] = [];
  if (spec.stockSize !== undefined) {
    if (spec.stockSize < stockTop.length) throw new Error("stockSize is smaller than stockTop");
    buried = stock.slice(spec.stockSize);
    stock = stock.slice(0, spec.stockSize);
  }

  return {
    config,
    seed: spec.seed,
    roundNumber: spec.roundNumber ?? 1,
    players,
    currentSeat: spec.currentSeat ?? 0,
    phase: spec.phase ?? "draw",
    stock,
    discard: [...buried, ...pile],
  };
}
