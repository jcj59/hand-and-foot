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
});
