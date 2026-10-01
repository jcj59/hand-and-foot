import { afterEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { EAST_COAST, type Card } from "@hf/shared";
import { buildTimeline, type Timeline } from "@hf/engine";
import { recordRich } from "@hf/engine/testing";
import { SCENARIOS, buildScenario } from "@hf/scenarios";
import { cardLabel } from "../cards/cardText";
import { describeStep } from "./navigate";
import { delayAt } from "./playback";
import { Player, type PlayerProps } from "./Player";

// A golden game from the engine's replay tests, exactly as they record it: a seed and
// the actions, with nothing scenario-shaped about it. The player has to take it as is.
const golden = recordRich(36, 4, 150);
const goldenTimeline = buildTimeline({
  config: EAST_COAST,
  setup: { seed: 36, playerCount: 4 },
  actions: golden.actions,
});

function scenario(id: string): Timeline {
  return buildTimeline(buildScenario(SCENARIOS.find((s) => s.id === id)!));
}

function mount(props: Partial<PlayerProps> & { timeline: Timeline }) {
  const onMainMenu = vi.fn();
  const utils = render(<Player onMainMenu={onMainMenu} {...props} />);
  return { ...utils, onMainMenu };
}

/** The cards shown in a seat's hand (or foot), by accessible name, sorted. */
function shownCards(name: RegExp): string[] {
  return within(screen.getByRole("region", { name }))
    .getAllByRole("img")
    .map((el) => el.getAttribute("aria-label")!)
    .sort();
}
const labels = (cards: readonly Card[]) => cards.map(cardLabel).sort();
const position = () => screen.getByLabelText("Position").textContent ?? "";

afterEach(() => {
  vi.useRealTimers();
});

describe("the player, fed a golden game", () => {
  it("shows the watched seat's own cards at every step it is taken to", () => {
    mount({ timeline: goldenTimeline });
    expect(position()).toMatch(/^Step 0 of 150/);
    expect(shownCards(/^Seat 0's hand$/)).toEqual(
      labels(goldenTimeline.stateAt(0).players[0]!.hand),
    );

    for (const step of [40, 7, 113, 150, 0]) {
      fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: String(step) } });
      expect(position()).toMatch(new RegExp(`^Step ${step} of 150`));
      const me = goldenTimeline.stateAt(step).players[0]!;
      expect(shownCards(/^Seat 0's (hand|foot)$/)).toEqual(labels(me.inFoot ? me.foot : me.hand));
    }
  });

  it("steps forward and back one action at a time", () => {
    mount({ timeline: goldenTimeline });
    fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
    expect(
      position().startsWith(
        `Step 1 of 150 · Round 1 · Seat 0's turn · ${describeStep(goldenTimeline, 1)}`,
      ),
    ).toBe(true);
    const me = goldenTimeline.stateAt(1).players[0]!;
    expect(shownCards(/^Seat 0's hand$/)).toEqual(labels(me.hand));
    fireEvent.click(screen.getByRole("button", { name: "Step back" }));
    expect(position()).toMatch(/^Step 0 of 150/);
    expect(screen.getByRole("button", { name: "Step back" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Jump to the end" }));
    expect(position()).toMatch(/^Step 150 of 150/);
    expect(screen.getByRole("button", { name: "Step forward" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to the start" }));
    expect(position()).toMatch(/^Step 0 of 150/);
  });

  it("watches any seat, through that seat's own view", () => {
    mount({ timeline: goldenTimeline, start: { step: 20 } });
    fireEvent.change(screen.getByLabelText("Watch"), { target: { value: "2" } });
    expect(shownCards(/^Seat 2's (hand|foot)$/)).toEqual(
      labels(goldenTimeline.stateAt(20).players[2]!.hand),
    );
    // Nobody else's cards are on the table, only their counts.
    expect(screen.queryByRole("region", { name: /^Seat 0's hand$/ })).toBeNull();
  });

  it("shows every hand face up when asked, which no seat could see", () => {
    mount({ timeline: goldenTimeline, start: { step: 10 } });
    expect(screen.queryByRole("region", { name: "Every hand" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Every hand" }));
    const all = screen.getByRole("region", { name: "Every hand" });
    const ben = within(all)
      .getByRole("group", { name: "Seat 1's hand" })
      .querySelectorAll("[role=img]");
    expect(ben).toHaveLength(goldenTimeline.stateAt(10).players[1]!.hand.length);
  });

  it("jumps by turn, to the end of a turn, and to a round", () => {
    mount({ timeline: goldenTimeline, start: { step: 0 } });
    const [first, second] = goldenTimeline.turns;
    fireEvent.click(screen.getByRole("button", { name: "Next turn" }));
    expect(position()).toMatch(new RegExp(`^Step ${second!.start} of`));
    fireEvent.click(screen.getByRole("button", { name: "Previous turn" }));
    expect(position()).toMatch(new RegExp(`^Step ${first!.start} of`));
    fireEvent.click(screen.getByRole("button", { name: "End of this turn" }));
    expect(position()).toMatch(new RegExp(`^Step ${first!.end} of`));
    fireEvent.change(screen.getByLabelText("Jump to a round"), { target: { value: "150" } });
    expect(position()).toMatch(/^Step 150 of/);
  });

  it("is only watched: nothing on the table can be played, and there is no clock", () => {
    mount({ timeline: goldenTimeline });
    expect(screen.queryByRole("button", { name: "Draw a card" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByText("Seat 0 to play.")).toBeInTheDocument();
  });

  it("plays itself on a timer, and says when it reaches the end of its range", () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    mount({ timeline: goldenTimeline, range: { from: 0, to: 3 }, autoplay: true, onEnd });
    expect(position()).toMatch(/^Step 0 of/);
    const first = delayAt(goldenTimeline, 0, 1);
    act(() => vi.advanceTimersByTime(first - 1));
    expect(position()).toMatch(/^Step 0 of/);
    act(() => vi.advanceTimersByTime(1));
    expect(position()).toMatch(/^Step 1 of/);
    // One move per wait: the next is scheduled once the table has shown this one.
    for (let i = 0; i < 6; i++) act(() => vi.advanceTimersByTime(10_000));
    expect(position()).toMatch(/^Step 3 of/);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("stops, without ending the range, when a jump while playing lands at the end", () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    mount({ timeline: goldenTimeline, autoplay: true, onEnd });
    fireEvent.click(screen.getByRole("button", { name: "Jump to the end" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(position()).toMatch(/^Step 150 of 150/);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("reports where it is, so a caller can keep a link to it", () => {
    const onPositionChange = vi.fn();
    mount({ timeline: goldenTimeline, onPositionChange });
    fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
    expect(onPositionChange).toHaveBeenLastCalledWith({ step: 1, seat: 0, revealAll: false });
  });
});

describe("the player's moments", () => {
  it("marks every moment on the timeline, and jumps between them", () => {
    const t = scenario("marva");
    mount({ timeline: t });
    const named = t.moments.find((m) => m.id === "getdown")!;
    fireEvent.click(screen.getByRole("button", { name: `Go to: ${named.label}` }));
    expect(position()).toMatch(new RegExp(`^Step ${named.step} of`));
    expect(screen.getByLabelText("Moment")).toHaveTextContent(`★ ${named.label}`);
    // Nothing is marked before it, and the next is the next step that has anything.
    expect(screen.getByRole("button", { name: "Previous moment" })).toBeDisabled();
    const after = t.moments.find((m) => m.step > named.step)!;
    fireEvent.click(screen.getByRole("button", { name: "Next moment" }));
    expect(position()).toMatch(new RegExp(`^Step ${after.step} of`));
    fireEvent.click(screen.getByRole("button", { name: "Previous moment" }));
    expect(position()).toMatch(new RegExp(`^Step ${named.step} of`));
  });

  it("announces Grabby Pants when playing reaches it, and not when a jump lands past it", () => {
    const t = scenario("grabby-pants");
    const earned = t.moments.find((m) => m.kind === "grabbyPants")!;
    const { unmount } = mount({ timeline: t, start: { step: earned.step - 1 } });
    fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: String(earned.step) } });
    expect(screen.queryByRole("status", { name: "Grabby Pants" })).toBeNull();
    unmount();

    mount({ timeline: t, start: { step: earned.step - 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
    expect(screen.getByRole("status", { name: "Grabby Pants" })).toHaveTextContent(
      "Ana is Grabby Pants",
    );
  });

  it("celebrates the Marva Rule when playing reaches it, and not when a jump lands on it", () => {
    const t = scenario("marva");
    const marva = t.moments.find((m) => m.kind === "marva")!;
    const { unmount } = mount({ timeline: t, start: { step: marva.step - 1 } });
    fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: String(marva.step) } });
    expect(screen.queryByRole("status", { name: "Marva Rule" })).toBeNull();
    unmount();

    mount({ timeline: t, start: { step: marva.step - 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Step forward" }));
    expect(screen.getByRole("status", { name: "Marva Rule" })).toHaveTextContent(
      "Ana got down by emptying the hand",
    );
  });

  it("shows the round's scores when a round has ended, with nothing to click", () => {
    const t = scenario("black-three-book");
    mount({ timeline: t, start: { step: t.length } });
    const scores = screen.getByRole("dialog", { name: "Round result" });
    expect(within(scores).getByText("Ana went out!")).toBeInTheDocument();
    expect(within(scores).queryByRole("button", { name: "Next round" })).toBeNull();
    expect(within(scores).queryByRole("button", { name: "Back to the main screen" })).toBeNull();
  });

  it("leaves through the table's main menu button", () => {
    const { onMainMenu } = mount({ timeline: scenario("marva") });
    fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
    expect(onMainMenu).toHaveBeenCalled();
  });

  it("answers the keyboard: space plays, the arrows step, and with shift jump between moments", () => {
    const t = scenario("marva");
    mount({ timeline: t });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(position()).toMatch(/^Step 1 of/);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(position()).toMatch(/^Step 0 of/);
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    const first = t.moments[0]!.step;
    expect(position()).toMatch(new RegExp(`^Step ${first} of`));
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    expect(position()).toMatch(new RegExp(`^Step ${first} of`));
    // With no moment before, shift-left stays put.
    fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true });
    expect(position()).toMatch(new RegExp(`^Step ${first} of`));
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    // Typing into a control is not a shortcut.
    fireEvent.keyDown(screen.getByLabelText("Speed"), { key: " " });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("changes speed, and says so to whoever is keeping it", () => {
    const onSpeedChange = vi.fn();
    mount({ timeline: scenario("marva"), onSpeedChange });
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "instant" } });
    expect(onSpeedChange).toHaveBeenLastCalledWith("instant");
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "4" } });
    expect(onSpeedChange).toHaveBeenLastCalledWith(4);
  });
});
