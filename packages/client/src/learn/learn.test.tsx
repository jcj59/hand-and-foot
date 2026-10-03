import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LESSONS } from "@hf/scenarios";
import { LessonList, LessonPage, TUTOR_MOVE_MS, demoTimeline } from "./Learn";
import { loadProgress, markDone, PROGRESS_KEY } from "./progress";
import { narrate } from "./narrate";

function mount(at: string): void {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/learn" element={<LessonList />} />
        <Route path="/learn/:lessonId" element={<LessonPage />} />
        <Route path="/" element={<p>main screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.removeItem(PROGRESS_KEY));
afterEach(() => vi.useRealTimers());

describe("the lessons", () => {
  it("are listed in order, with the ones this device finished ticked", () => {
    markDone("pile");
    mount("/learn");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace("✓", "").trim())).toEqual(
      LESSONS.map((l, i) => `${i + 1}. ${l.title}`),
    );
    expect(within(items[3]!).getByLabelText("done")).toBeInTheDocument();
    expect(within(items[0]!).queryByLabelText("done")).toBeNull();
  });

  it("teach a turn at the real table: the coach asks, the learner plays, the computer answers", async () => {
    mount("/learn/turn");
    const coach = screen.getByRole("complementary", { name: "Coach" });
    expect(coach).toHaveTextContent("Every turn has two halves");
    expect(coach).toHaveTextContent("Click the stock to draw a card.");
    fireEvent.click(screen.getByRole("button", { name: /draw a card/i }));
    // The table is busy until the move is answered.
    await act(async () => {});
    expect(coach).toHaveTextContent("Step 2 of 2");
    // Any card will do: pick the first and discard it.
    const hand = screen.getByRole("region", { name: /^your hand$/i });
    fireEvent.click(within(hand).getByRole("button", { name: "Four of clubs" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^discard$/i }));
    await act(async () => {});
    expect(coach).toHaveTextContent("Lesson done.");
    expect(loadProgress().has("turn")).toBe(true);
    expect(screen.getByRole("button", { name: "Next: Getting down" })).toBeInTheDocument();
    // The computer player then takes its turn, at its own pace.
    const seat = (): string =>
      screen.getByRole("listitem", { name: /^Robo Rita/ }).getAttribute("aria-label")!;
    const before = seat();
    await act(() => new Promise((resolve) => setTimeout(resolve, TUTOR_MOVE_MS + 50)));
    expect(seat()).not.toBe(before);
  });

  it("refuse a move that is not the one asked for, saying why", () => {
    mount("/learn/pile");
    fireEvent.click(screen.getByRole("button", { name: /draw a card/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Click the discard pile to take all of it.",
    );
  });

  it("send an unknown lesson back to the list", () => {
    mount("/learn/nope");
    expect(screen.getByRole("heading", { name: "Learn to play" })).toBeInTheDocument();
  });
});

describe("progress through the lessons", () => {
  it("is kept on this device, and survives storage that is broken or blocked", () => {
    markDone("turn");
    markDone("turn");
    expect([...loadProgress()]).toEqual(["turn"]);
    window.localStorage.setItem(PROGRESS_KEY, "{not json");
    expect(loadProgress().size).toBe(0);
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(["a", 3]));
    expect([...loadProgress()]).toEqual(["a"]);
  });
});

describe("the demo game", () => {
  const timeline = demoTimeline();

  it("is a whole round of computer players", () => {
    expect(timeline.stateAt(timeline.length).roundEnded).toBe(true);
    expect(timeline.nameOf(0)).toBe("Robo Rita");
  });

  it("says what each move did, and why where the table can tell", () => {
    const lines = Array.from({ length: timeline.length + 1 }, (_, step) => narrate(timeline, step));
    expect(lines[0]).toContain("Watch the computer players play a round");
    expect(lines.some((l) => / drew from the stock/.test(l))).toBe(true);
    expect(
      lines.some((l) => / took the pile, \d+ cards?: a card in it could be melded/.test(l)),
    ).toBe(true);
    expect(
      lines.some((l) => / got down with \d+ points, over the 60 this round needs\./.test(l)),
    ).toBe(true);
    expect(lines.some((l) => / discarded a /.test(l))).toBe(true);
    expect(lines.some((l) => /went out/.test(l))).toBe(true);
    expect(
      lines.some((l) => / discarded an? (8|ace)\b/.test(l) || / discarded a [^8a]/.test(l)),
    ).toBe(true);
  });

  it("plays in the shared player, with the narration under the position", () => {
    mount("/learn/demo");
    expect(screen.getByLabelText("Narration")).toHaveTextContent("Watch the computer players");
  });
});
