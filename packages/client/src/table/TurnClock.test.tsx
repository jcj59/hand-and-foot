import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ClockState } from "@hf/shared";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import { TICK_MS, TurnClock } from "./TurnClock";

function clockState(overrides: Partial<ClockState> = {}): ClockState {
  return {
    serverNow: 1_000_000,
    deadlineAt: 1_060_000,
    inDiscardGrace: false,
    paused: false,
    ...overrides,
  };
}

/** Anchor the session clock to a server time, as an arriving update would. */
function anchorTo(serverNow: number): void {
  const clock = createServerClock();
  clock.anchor(serverNow);
  useSession.setState({ clock });
}

beforeEach(() => {
  // Fake timers also fake Date, so advancing them advances what the session clock
  // reads as "now" — which is what makes the countdown observable without sleeping.
  vi.useFakeTimers();
  useSession.setState({ clock: createServerClock() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reading the deadline", () => {
  it("counts from the server's clock, not the browser's", () => {
    // The browser is an hour behind the server here. Subtracting the browser's own
    // clock would read the deadline as wildly wrong.
    vi.setSystemTime(0);
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState()} />);
    expect(screen.getByRole("timer").textContent).toMatch(/1:00/);
  });

  it("shows a dash and says so when the table is paused", () => {
    // A paused table sends no deadline; that is not zero seconds left.
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState({ deadlineAt: null, paused: true })} />);
    expect(screen.getByRole("timer").textContent).toMatch(/—/);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it("names the discard-only grace", () => {
    // Melding is closed but the player still chooses their own card; saying nothing
    // would leave a refused meld unexplained.
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState({ inDiscardGrace: true })} />);
    expect(screen.getByText(/discard only/i)).toBeInTheDocument();
  });
});

describe("ticking", () => {
  it("counts down between updates", () => {
    // The decisive behaviour: views only arrive when somebody moves, so a clock that
    // waited for one would sit frozen through the whole turn.
    vi.setSystemTime(0);
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState()} />);
    expect(screen.getByRole("timer").textContent).toMatch(/1:00/);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole("timer").textContent).toMatch(/0:40/);

    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    expect(screen.getByRole("timer").textContent).toMatch(/0:00/);
  });

  it("stops at zero rather than going negative", () => {
    vi.setSystemTime(0);
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState()} />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByRole("timer").textContent).toMatch(/0:00/);
    expect(screen.getByRole("timer").textContent).not.toMatch(/-/);
  });

  it("turns urgent inside the last ten seconds", () => {
    vi.setSystemTime(0);
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState()} />);
    const digits = (): Element => screen.getByRole("timer").firstElementChild!;
    expect(digits.call(null).className).toMatch(/text-white/);

    act(() => {
      vi.advanceTimersByTime(52_000);
    });
    expect(digits.call(null).className).toMatch(/text-red-300/);
  });

  it("arms no timer when there is no deadline", () => {
    // Nothing to count down, and a paused table should not be waking the tab.
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState({ deadlineAt: null, paused: true })} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases its timer on unmount", () => {
    // Left armed, it would keep setting state on a component that is gone.
    anchorTo(1_000_000);
    const { unmount } = render(<TurnClock clock={clockState()} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a new deadline at once rather than after a tick", () => {
    // The turn clock is re-armed on every accepted action, so waiting a tick would
    // show the previous turn's remaining time on the first frame of this one.
    vi.setSystemTime(0);
    anchorTo(1_000_000);
    const { rerender } = render(<TurnClock clock={clockState()} />);
    rerender(<TurnClock clock={clockState({ deadlineAt: 1_030_000 })} />);
    expect(screen.getByRole("timer").textContent).toMatch(/0:30/);
  });

  it("ticks four times a second by default", () => {
    // Smooth enough to look live, cheap enough to ignore. Pinned as a literal so a
    // change is deliberate.
    expect(TICK_MS).toBe(250);
  });

  it("accepts an injected interval", () => {
    vi.setSystemTime(0);
    anchorTo(1_000_000);
    render(<TurnClock clock={clockState()} tickMs={5_000} />);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole("timer").textContent).toMatch(/0:55/);
  });
});
