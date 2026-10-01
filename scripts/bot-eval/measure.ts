/**
 * Headless measurement of the heuristic bot (roadmap item 7a).
 *
 *   pnpm bot:measure                       # 500 matches per row, East Coast
 *   pnpm bot:measure --matches 2000 --preset west --seed 100
 *
 * Plays whole matches through `playMatch` from `@hf/engine` and reports, for two,
 * three and four players: the heuristic's win rate against `defaultAction`, its
 * win share against copies of itself, and whether the rounds actually end. A
 * table of nothing but `defaultAction` is played too, as the control: it never
 * melds, so it never ends a round, and the arena calls the round stalled.
 *
 * Every match is seeded (seed = base + match index), so a run is reproducible
 * and two runs with the same arguments print the same numbers.
 */
import { parseArgs } from "node:util";
import { EAST_COAST, WEST_COAST, type RulesConfig } from "../../packages/shared/src/index";
import {
  type MatchResult,
  type Policy,
  defaultPolicy,
  heuristicPolicy,
  playMatch,
  winners,
} from "../../packages/engine/src/index";

const { values } = parseArgs({
  options: {
    matches: { type: "string", default: "500" },
    seed: { type: "string", default: "1" },
    preset: { type: "string", default: "east" },
  },
});
const matches = Number(values.matches);
const base = Number(values.seed);
if (!Number.isInteger(matches) || matches < 1 || !Number.isInteger(base)) {
  throw new Error("--matches must be a positive integer and --seed an integer");
}
const presets: Record<string, RulesConfig> = { east: EAST_COAST, west: WEST_COAST };
const config = presets[values.preset];
if (!config) throw new Error(`--preset must be one of: ${Object.keys(presets).join(", ")}`);

/** A seat's share of a match: 1 for a sole win, split evenly on a tie. */
function share(result: MatchResult, seat: number): number {
  const top = winners(result);
  return top.includes(seat) ? 1 / top.length : 0;
}

interface Tally {
  heuristicWins: number;
  roundsEnded: number;
  roundsWentOut: number;
  roundsPlayed: number;
  actions: number;
  seatWins: number[];
}

/**
 * Play `count` matches with a seating chosen per match. `seat(i)` names the seat
 * whose share counts as "the heuristic's", or null when every seat is the same.
 */
function run(
  players: number,
  count: number,
  seating: (i: number) => { policies: Policy[]; heuristicSeat: number | null },
): Tally {
  const tally: Tally = {
    heuristicWins: 0,
    roundsEnded: 0,
    roundsWentOut: 0,
    roundsPlayed: 0,
    actions: 0,
    seatWins: Array<number>(players).fill(0),
  };
  for (let i = 0; i < count; i++) {
    const { policies, heuristicSeat } = seating(i);
    const result = playMatch(policies, config, base + i);
    if (heuristicSeat !== null) tally.heuristicWins += share(result, heuristicSeat);
    for (let seat = 0; seat < players; seat++) tally.seatWins[seat] += share(result, seat);
    tally.roundsEnded += result.roundsEnded;
    tally.roundsWentOut += result.wentOut.filter((seat) => seat !== null).length;
    // A stalled match stops in the round that stalled: count it as played.
    tally.roundsPlayed += result.complete ? config.rounds : result.roundsEnded + 1;
    tally.actions += result.actions;
  }
  return tally;
}

const pct = (part: number, whole: number): string => `${((100 * part) / whole).toFixed(1)}%`;

console.log(
  `Heuristic bot measurement — preset ${values.preset}, ${matches} matches per row, ` +
    `seeds ${base}..${base + matches - 1}\n`,
);

console.log("Heuristic vs defaultAction (one heuristic seat, rotating; the rest default)");
for (const players of [2, 3, 4]) {
  const t = run(players, matches, (i) => {
    const heuristicSeat = i % players;
    const policies = Array.from({ length: players }, (_, seat) =>
      seat === heuristicSeat ? heuristicPolicy : defaultPolicy,
    );
    return { policies, heuristicSeat };
  });
  console.log(
    `  ${players} players: heuristic wins ${pct(t.heuristicWins, matches)} ` +
      `(${+t.heuristicWins.toFixed(1)} of ${matches}); rounds ended ${t.roundsEnded}/${t.roundsPlayed}`,
  );
}

console.log("\nHeuristic vs itself (every seat heuristic)");
for (const players of [2, 3, 4]) {
  const t = run(players, matches, () => ({
    policies: Array<Policy>(players).fill(heuristicPolicy),
    heuristicSeat: null,
  }));
  const seats = t.seatWins.map((w) => pct(w, matches)).join(" / ");
  console.log(
    `  ${players} players: win share by seat ${seats} (fair: ${pct(1, players)}); ` +
      `rounds ended ${t.roundsEnded}/${t.roundsPlayed}, ` +
      `${t.roundsWentOut} by going out; ${(t.actions / t.roundsEnded).toFixed(0)} actions per round`,
  );
}

// The control. Each default-only match stalls in its first round and costs a full
// `ROUND_ACTION_LIMIT` of actions, so a tenth as many are enough to show it.
const control = Math.max(1, Math.round(matches / 10));
console.log(`\nControl: defaultAction only (${control} matches per row)`);
for (const players of [2, 3, 4]) {
  const t = run(players, control, () => ({
    policies: Array<Policy>(players).fill(defaultPolicy),
    heuristicSeat: null,
  }));
  console.log(`  ${players} players: rounds ended ${t.roundsEnded}/${t.roundsPlayed}`);
}
