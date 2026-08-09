import { describe, it, expect } from "vitest";
import { prng, shuffle } from "./rng";
import { buildShoe } from "./deck";

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("prng and shuffle", () => {
  it("is deterministic for a fixed seed (L4 anchor)", () => {
    const a = shuffle(buildShoe(2), prng(42));
    const b = shuffle(buildShoe(2), prng(42));
    expect(ids(a)).toEqual(ids(b));
  });

  it("produces a permutation (conserves the multiset of cards)", () => {
    const shoe = buildShoe(2);
    const shuffled = shuffle(shoe, prng(7));
    expect(shuffled).toHaveLength(shoe.length);
    expect(ids(shuffled).sort()).toEqual(ids(shoe).sort());
  });

  it("depends on the seed", () => {
    const a = ids(shuffle(buildShoe(2), prng(1)));
    const b = ids(shuffle(buildShoe(2), prng(2)));
    expect(a).not.toEqual(b);
  });

  it("does not mutate its input", () => {
    const shoe = buildShoe(2);
    const before = ids(shoe);
    const shuffled = shuffle(shoe, prng(3));
    expect(ids(shoe)).toEqual(before);
    expect(shuffled).not.toBe(shoe);
    // Guard against the seed happening to produce the identity permutation, which
    // would make the check above pass for the wrong reason.
    expect(ids(shuffled)).not.toEqual(before);
  });

  // The loop runs from length-1 down to 1, so these two sizes never enter it.
  it("handles empty and single-element inputs", () => {
    expect(shuffle([], prng(1))).toEqual([]);
    expect(shuffle(["only"], prng(1))).toEqual(["only"]);
  });

  // A Fisher-Yates loop that stops one step early still returns a permutation and
  // is still deterministic, so the tests above would not notice. A two-element
  // input is where that final swap is the *only* swap, which pins it.
  it("actually shuffles a two-element input", () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      orders.add(shuffle(["a", "b"], prng(seed)).join(""));
    }
    expect(orders).toEqual(new Set(["ab", "ba"]));
  });

  // Every position must be reachable by every element, not just most of them.
  it("moves each element into every position across seeds", () => {
    const positions = [new Set<number>(), new Set<number>(), new Set<number>()];
    for (let seed = 1; seed <= 200; seed++) {
      const out = shuffle([0, 1, 2], prng(seed));
      out.forEach((value, index) => positions[value].add(index));
    }
    for (const seen of positions) expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it("yields values in [0, 1)", () => {
    const rng = prng(12345);
    let min = Infinity;
    let max = -Infinity;
    // One assertion rather than 10k: a per-value expect() is needlessly expensive.
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it("does not immediately repeat itself, and differs across seeds", () => {
    const rng = prng(9);
    const run = Array.from({ length: 500 }, () => rng());
    expect(new Set(run).size).toBeGreaterThan(490);
    const other = prng(10);
    expect(Array.from({ length: 500 }, () => other())).not.toEqual(run);
  });

  it("is a pure function of the seed, not of call history", () => {
    const a = prng(77);
    const first = [a(), a(), a()];
    const b = prng(77);
    expect([b(), b(), b()]).toEqual(first);
  });
});
