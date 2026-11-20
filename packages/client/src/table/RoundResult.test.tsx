import { afterEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  applyAction,
  deal,
  defaultPolicy,
  heuristicPolicy,
  isMatchOver,
  roundResult,
  type Policy,
} from "@hf/engine";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type HeldCards,
  type Rank,
  type RoomInfo,
  type RoundEnded,
  type RulesConfig,
  type ScoreBreakdown,
  type Suit,
} from "@hf/shared";
import { PHONE_QUERY } from "../usePhone";
import { ARROW_STEP, ARROW_STEP_FAST, EDGE_MARGIN } from "./drag";
import { RoundResult } from "./RoundResult";

const card = (rank: Rank, suit: Suit | null, n = 0): Card => ({
  id: `${rank}-${suit}-${n}`,
  rank,
  suit,
});

function room(names: readonly string[], config: RulesConfig = EAST_COAST): RoomInfo {
  return {
    roomId: "ABC234",
    players: names.map((name, seat) => ({ seat, name, connected: true })),
    hostSeat: 0,
    playAgain: [],
    nextRoundReady: [],
    started: true,
    config,
  };
}

function show(result: RoundEnded, names: readonly string[], config = EAST_COAST, seat = 0) {
  return render(
    <RoundResult
      result={result}
      room={room(names, config)}
      config={config}
      actions={null}
      seat={seat}
      notice={null}
    />,
  );
}

const ZERO: ScoreBreakdown = {
  cleanBooks: 0,
  dirtyBooks: 0,
  bookBonus: 0,
  meldedCards: 0,
  goOutBonus: 0,
  heldCount: 0,
  heldPenalty: 0,
  redThreesHeld: 0,
};

/** A number as the board writes it ("-1,045") back to a number. */
const parse = (text: string): number => Number(text.replace(/,/g, "").replace(/^\+/, ""));

/** The sums of a row's opened groups, read off their names ("Hand, 3 cards: -25"). */
function groupSums(region: HTMLElement): Map<string, number> {
  const list = within(region).queryByRole("list", { name: "Cards left" });
  const items = list ? within(list).getAllByRole("listitem") : [];
  return new Map(
    items.map((li) => {
      const [label, sum] = li.getAttribute("aria-label")!.split(": ");
      return [label!, parse(sum!)];
    }),
  );
}

/**
 * Real rounds, scored by the engine: two heuristic players and one that never
 * melds (the server's timeout default), so feet go unreached and red threes stay
 * in hand. Every round of each match, as the table would send it.
 */
function playedResults(seed: number): RoundEnded[] {
  const policies: Policy[] = [heuristicPolicy, heuristicPolicy, defaultPolicy];
  let state: GameState = deal(policies.length, EAST_COAST, seed);
  const results: RoundEnded[] = [];
  for (let moves = 0; moves < 30_000; moves++) {
    if (state.roundEnded) {
      results.push(roundResult(state)!);
      if (isMatchOver(state)) break;
      state = (applyAction(state, { type: "nextRound" }) as { state: GameState }).state;
      continue;
    }
    const action = policies[state.currentSeat]!(state, state.currentSeat)!;
    const next = applyAction(state, action);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  return results;
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("each player's cards at the end of a round", () => {
  it("adds up, for every seat of real rounds, to the penalty the engine scored", () => {
    const names = ["Ana", "Ben", "Cy"];
    let rows = 0;
    let untouched = 0;
    let redThrees = 0;
    for (const seed of [11, 12]) {
      for (const result of playedResults(seed)) {
        const view = show(result, names);
        for (const { seat, score, breakdown: b } of result.scores) {
          const row = screen.getByRole("listitem", { name: `${names[seat]}: ${score}` });
          fireEvent.click(within(row).getByRole("button", { name: "Show cards" }));
          const region = within(row).getByRole("region", { name: /cards$/ });
          const sums = groupSums(region);
          const shown = [...sums.values()].reduce((a, n) => a + n, 0);
          // The point of the whole breakdown: the lines add up to the score's penalty.
          expect(shown, `seat ${seat}, round ${result.roundNumber}`).toBe(b.heldPenalty);
          // And each card's cost under it adds up the same way.
          const list = within(region).queryByRole("list", { name: "Cards left" });
          const costs = (list ? within(list).queryAllByText(/^(-[\d,]+|0)$/) : [])
            // Each card's cost, not its group's sum (which sits in the group's heading).
            .filter((el) => el.parentElement?.tagName === "SPAN")
            .map((el) => parse(el.textContent!));
          expect(costs.reduce((a, n) => a + n, 0)).toBe(b.heldPenalty);
          expect(costs).toHaveLength(b.heldCount);
          // The Red 3s column is what the red threes among them cost.
          const red = [...sums].find(([label]) => label.startsWith("Red threes"));
          expect(red?.[1] ?? 0).toBe(b.redThreesHeld === 0 ? 0 : -500 * b.redThreesHeld);
          expect(row.textContent).toContain(
            b.redThreesHeld === 0 ? "" : `-${(500 * b.redThreesHeld).toLocaleString("en-US")}`,
          );
          // And the score is the sum of its parts, as the row says.
          expect(region).toHaveTextContent(`Cards left ${signedText(b.heldPenalty)}`);
          expect(b.bookBonus + b.meldedCards + b.goOutBonus + b.heldPenalty).toBe(score);
          const held = result.held!.find((h) => h.seat === seat)!;
          if (held.footUntouched && held.foot.length > 0) {
            untouched++;
            expect([...sums.keys()].some((l) => l.endsWith("never reached"))).toBe(true);
          }
          redThrees += b.redThreesHeld;
          rows++;
        }
        view.unmount();
      }
    }
    // The rounds really did exercise what the board is for.
    expect(rows).toBeGreaterThanOrEqual(12);
    expect(untouched).toBeGreaterThan(0);
    expect(redThrees).toBeGreaterThan(0);
  });

  it("says a foot was never reached, splits out the red threes, and opens and closes", () => {
    const held: HeldCards = {
      seat: 1,
      hand: [card("K", "spades"), card("3", "hearts"), card("5", "clubs")],
      foot: [card("JOKER", null), card("9", "diamonds"), card("3", "diamonds")],
      footUntouched: true,
    };
    // K 10 + 5 5 in hand, joker 50 + 9 5 in the foot, two red threes 1,000.
    const heldPenalty = -1070;
    const result: RoundEnded = {
      scores: [
        { seat: 0, score: 900, breakdown: { ...ZERO, meldedCards: 400, bookBonus: 500 } },
        {
          seat: 1,
          score: 60 + heldPenalty,
          breakdown: { ...ZERO, meldedCards: 60, heldCount: 6, heldPenalty, redThreesHeld: 2 },
        },
      ],
      wentOutSeat: 0,
      roundNumber: 1,
      totals: [900, 60 + heldPenalty],
      matchOver: false,
      held: [{ seat: 0, hand: [], foot: [], footUntouched: false }, held],
    };
    show(result, ["Ana", "Ben"]);
    const ben = screen.getByRole("listitem", { name: /^Ben:/ });
    // The Red 3s column, beside cards left.
    expect(ben.textContent).toMatch(/Ben\s*Show cards\s*0\s*0\s*60\s*6\s*-1,000\s*-1,010/);
    const toggle = within(ben).getByRole("button", { name: "Show cards" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const region = within(ben).getByRole("region", { name: "Ben's cards" });
    expect(toggle).toHaveAttribute("aria-controls", region.id);
    expect([...groupSums(region)]).toEqual([
      ["Hand, 2 cards", -15],
      ["Foot, 2 cards, never reached", -55],
      ["Red threes, 2", -1000],
    ]);
    expect(within(region).getByRole("img", { name: /joker/i })).toBeInTheDocument();
    expect(region).toHaveTextContent(
      "Books 0Cards melded +60Going out 0Cards left -1,070Round -1,010",
    );
    // The player who went out holds nothing.
    const ana = screen.getByRole("listitem", { name: /^You:|^Ana:/ });
    fireEvent.click(within(ana).getByRole("button", { name: "Show cards" }));
    expect(within(ana).getByRole("region", { name: "Your cards" })).toHaveTextContent(
      "No cards left in hand or foot.",
    );
    fireEvent.click(within(ben).getByRole("button", { name: "Hide cards" }));
    expect(within(ben).queryByRole("region")).toBeNull();
    // The recap says what the red threes cost.
    expect(screen.getByRole("list", { name: "Round recap" })).toHaveTextContent(
      "Ben was caught with 2 red threes, -1000.",
    );
  });

  it("names a foot that was picked up without 'never reached'", () => {
    const result: RoundEnded = {
      scores: [
        {
          seat: 0,
          score: -20,
          breakdown: { ...ZERO, heldCount: 2, heldPenalty: -20 },
        },
      ],
      roundNumber: 1,
      totals: [-20],
      matchOver: false,
      held: [
        {
          seat: 0,
          hand: [],
          foot: [card("Q", "hearts"), card("J", "clubs")],
          footUntouched: false,
        },
      ],
    };
    show(result, ["Ana"]);
    fireEvent.click(screen.getByRole("button", { name: "Show cards" }));
    expect([...groupSums(screen.getByRole("region", { name: "Your cards" }))]).toEqual([
      ["Foot, 2 cards", -20],
    ]);
  });

  it("offers no cards for a result without them, or for a player who sat the round out", () => {
    const result: RoundEnded = {
      scores: [
        { seat: 0, score: 100, breakdown: { ...ZERO, meldedCards: 100 } },
        { seat: 1, score: 0, breakdown: ZERO },
        { seat: 2, score: 50, breakdown: { ...ZERO, meldedCards: 50 } },
      ],
      roundNumber: 2,
      totals: [300, 200, 100],
      matchOver: false,
      departed: [{ seat: 1, afterRound: 1 }],
      // A server from before `held` sends none at all. This one lists a seat that sat
      // the round out too, which the board does not open: it played no cards.
      held: [
        { seat: 0, hand: [], foot: [], footUntouched: false },
        { seat: 1, hand: [card("K", "spades")], foot: [], footUntouched: true },
      ],
    };
    show(result, ["Ana", "Ben", "Cy"]);
    expect(screen.getAllByRole("button", { name: "Show cards" })).toHaveLength(1);
    const { held: _held, ...old } = result;
    void _held;
    document.body.innerHTML = "";
    show(old, ["Ana", "Ben", "Cy"]);
    expect(screen.queryByRole("button", { name: "Show cards" })).toBeNull();
  });

  it("shows the opened cards on a phone too, where the red threes have no column", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === PHONE_QUERY,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    const result: RoundEnded = {
      scores: [
        {
          seat: 0,
          score: -505,
          breakdown: { ...ZERO, heldCount: 2, heldPenalty: -505, redThreesHeld: 1 },
        },
      ],
      roundNumber: 1,
      totals: [-505],
      matchOver: false,
      held: [
        {
          seat: 0,
          hand: [card("3", "hearts"), card("6", "spades")],
          foot: [],
          footUntouched: false,
        },
      ],
    };
    show(result, ["Ana"]);
    expect(screen.queryByText("Red 3s")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show cards" }));
    expect([...groupSums(screen.getByRole("region", { name: "Your cards" }))]).toEqual([
      ["Hand, 1 card", -5],
      ["Red threes, 1", -500],
    ]);
    // And nothing to drag the sheet by.
    expect(screen.queryByRole("button", { name: "Move the scores" })).toBeNull();
  });
});

describe("moving the scores aside on a computer", () => {
  const result = (over: Partial<RoundEnded> = {}): RoundEnded => ({
    scores: [{ seat: 0, score: 100, breakdown: { ...ZERO, meldedCards: 100 } }],
    roundNumber: 1,
    totals: [100],
    matchOver: false,
    ...over,
  });

  /** Where the board sits, as layout put it, for the clamp to measure. */
  function at(
    dialog: HTMLElement,
    box: { left: number; top: number; right: number; bottom: number },
  ) {
    vi.spyOn(dialog, "getBoundingClientRect").mockImplementation(() => {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(dialog.style.transform);
      const [x, y] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
      return {
        left: box.left + x,
        right: box.right + x,
        top: box.top + y,
        bottom: box.bottom + y,
        x: box.left + x,
        y: box.top + y,
        width: box.right - box.left,
        height: box.bottom - box.top,
        toJSON: () => ({}),
      };
    });
  }

  for (const matchOver of [false, true]) {
    it(`moves with the arrow keys, inside the window (${matchOver ? "match over" : "between rounds"})`, () => {
      show(result(matchOver ? { matchOver: true, roundNumber: 4 } : {}), ["Ana"]);
      const dialog = screen.getByRole("dialog", { name: "Round result" });
      // 1024 by 768 in jsdom: room for 116 to the right and 300 up.
      at(dialog, { left: 100, top: 308, right: 900, bottom: 768 });
      const grip = screen.getByRole("button", { name: "Move the scores" });
      expect(dialog.style.transform).toBe("translate(0px, 0px)");
      fireEvent.keyDown(grip, { key: "ArrowRight" });
      expect(dialog.style.transform).toBe(`translate(${ARROW_STEP}px, 0px)`);
      fireEvent.keyDown(grip, { key: "ArrowUp", shiftKey: true });
      expect(dialog.style.transform).toBe(`translate(${ARROW_STEP}px, -${ARROW_STEP_FAST}px)`);
      for (let i = 0; i < 10; i++) fireEvent.keyDown(grip, { key: "ArrowRight", shiftKey: true });
      for (let i = 0; i < 10; i++) fireEvent.keyDown(grip, { key: "ArrowUp", shiftKey: true });
      expect(dialog.style.transform).toBe(
        `translate(${1024 - EDGE_MARGIN - 900}px, -${308 - EDGE_MARGIN}px)`,
      );
      // Not past the bottom, where the sheet already sits.
      for (let i = 0; i < 10; i++) fireEvent.keyDown(grip, { key: "ArrowDown", shiftKey: true });
      expect(dialog.style.transform).toBe(`translate(${1024 - EDGE_MARGIN - 900}px, 0px)`);
      fireEvent.keyDown(grip, { key: "Enter" });
      expect(dialog.style.transform).toBe(`translate(${1024 - EDGE_MARGIN - 900}px, 0px)`);
    });
  }

  it("drags by the heading, lightens the backdrop, and opens the next result in place", () => {
    const view = show(result(), ["Ana"]);
    const dialog = screen.getByRole("dialog", { name: "Round result" });
    at(dialog, { left: 100, top: 308, right: 900, bottom: 768 });
    const backdrop = dialog.parentElement!;
    expect(backdrop.className).toContain("0.66");
    const heading = screen.getByRole("heading", { name: "Round 1 over" });
    fireEvent.pointerDown(heading, { button: 0, pointerId: 1, clientX: 500, clientY: 400 });
    fireEvent.pointerMove(heading, { pointerId: 1, clientX: 450, clientY: 300 });
    expect(dialog.style.transform).toBe("translate(-50px, -100px)");
    expect(backdrop.className).not.toContain("0.66");
    // Another pointer does not move it or let it go, and nor does this one once let go.
    fireEvent.pointerMove(heading, { pointerId: 2, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(heading, { pointerId: 2 });
    fireEvent.pointerMove(heading, { pointerId: 1, clientX: 440, clientY: 300 });
    expect(dialog.style.transform).toBe("translate(-60px, -100px)");
    fireEvent.pointerMove(heading, { pointerId: 1, clientX: 450, clientY: 300 });
    fireEvent.pointerUp(heading, { pointerId: 1 });
    fireEvent.pointerMove(heading, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(dialog.style.transform).toBe("translate(-50px, -100px)");
    // A press on a control in the heading is the control's, not a drag.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Move the scores" }), {
      button: 0,
      pointerId: 3,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(heading, { pointerId: 3, clientX: 900, clientY: 900 });
    expect(dialog.style.transform).toBe("translate(-50px, -100px)");
    // A second grab carries on from where the first left it.
    fireEvent.pointerDown(heading, { button: 0, pointerId: 5, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(heading, { pointerId: 5, clientX: 110, clientY: 120 });
    expect(dialog.style.transform).toBe("translate(-40px, -80px)");
    fireEvent.pointerUp(heading, { pointerId: 5 });
    // Nor does the right button drag.
    fireEvent.pointerDown(heading, { button: 2, pointerId: 4, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(heading, { pointerId: 4, clientX: 900, clientY: 900 });
    expect(dialog.style.transform).toBe("translate(-40px, -80px)");
    // The next round's result opens where results always do.
    view.rerender(
      <RoundResult
        result={result({ roundNumber: 2 })}
        room={room(["Ana"])}
        config={EAST_COAST}
        actions={null}
        seat={0}
        notice={null}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Round result" }).style.transform).toBe(
      "translate(0px, 0px)",
    );
  });

  it("lightens the backdrop for a board moved only up", () => {
    show(result(), ["Ana"]);
    const dialog = screen.getByRole("dialog", { name: "Round result" });
    at(dialog, { left: 100, top: 308, right: 900, bottom: 768 });
    fireEvent.keyDown(screen.getByRole("button", { name: "Move the scores" }), { key: "ArrowUp" });
    expect(dialog.parentElement!.className).not.toContain("0.66");
  });

  it("keeps a moved board inside a window made smaller", () => {
    show(result(), ["Ana"]);
    const dialog = screen.getByRole("dialog", { name: "Round result" });
    at(dialog, { left: 100, top: 308, right: 900, bottom: 768 });
    fireEvent.keyDown(screen.getByRole("button", { name: "Move the scores" }), {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(dialog.style.transform).toBe(`translate(${ARROW_STEP_FAST}px, 0px)`);
    const width = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 950 });
      act(() => void window.dispatchEvent(new Event("resize")));
      expect(dialog.style.transform).toBe(`translate(${950 - EDGE_MARGIN - 900}px, 0px)`);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});

function signedText(n: number): string {
  const digits = Math.abs(n).toLocaleString("en-US");
  return n > 0 ? `+${digits}` : n < 0 ? `-${digits}` : "0";
}
