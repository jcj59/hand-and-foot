import { afterEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { LastMove } from "@hf/shared";
import { CELEBRATION_DISMISS_AFTER_MS, CONFETTI_PIECES, confettiPieces } from "./Celebration";
import { SPEECH_GIVE_UP_MS, sayDeep } from "./grabby";
import { MARVA_MS, MarvaCelebration, useMarvaCelebration } from "./marva";

/** A speech engine that records what it is asked to say and finishes on demand. */
function fakeSpeech(): {
  said: string[];
  finish: () => void;
  cancels: () => number;
  restore: () => void;
} {
  const said: string[] = [];
  let cancelled = 0;
  let last: { onend: (() => void) | null; onerror: (() => void) | null } | null = null;
  class Utterance {
    pitch = 1;
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: Utterance,
  });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: (u: Utterance) => {
        said.push(u.text);
        last = u;
      },
      // As a browser does, cutting a line off reports it as an error.
      cancel: () => {
        cancelled++;
        last?.onerror?.();
      },
      getVoices: () => [{ name: "Daniel" }],
    },
  });
  return {
    said,
    finish: () => last?.onend?.(),
    cancels: () => cancelled,
    restore: () => {
      delete (window as { speechSynthesis?: unknown }).speechSynthesis;
      delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
    },
  };
}

const meld = (seq: number, marva?: true): LastMove => ({
  seq,
  seat: 1,
  kind: "meld",
  count: 4,
  ...(marva ? { marva } : {}),
});
const names = (seat: number) => ["Ana", "Ben"][seat]!;

afterEach(() => vi.useRealTimers());

describe("saying a line, then what follows it", () => {
  it("follows the line once it has been said, and only once", () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    try {
      const after = vi.fn();
      sayDeep("Marva Rule", after);
      expect(speech.said).toEqual(["Marva Rule"]);
      expect(after).not.toHaveBeenCalled();
      speech.finish();
      expect(after).toHaveBeenCalledTimes(1);
      // The give-up timer does not run it a second time.
      vi.advanceTimersByTime(SPEECH_GIVE_UP_MS);
      expect(after).toHaveBeenCalledTimes(1);
    } finally {
      speech.restore();
    }
  });

  it("goes ahead anyway when the device never says the line is done", () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    try {
      const after = vi.fn();
      sayDeep("Marva Rule", after);
      vi.advanceTimersByTime(SPEECH_GIVE_UP_MS);
      expect(after).toHaveBeenCalledTimes(1);
    } finally {
      speech.restore();
    }
  });

  it("goes straight on where there is no speech at all", () => {
    const after = vi.fn();
    sayDeep("Marva Rule", after);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("celebrating the Marva Rule", () => {
  function hook(initial: LastMove | undefined, options: { muted?: boolean; quiet?: boolean } = {}) {
    const horn = vi.fn();
    const utils = renderHook(
      ({ move, quiet }: { move: LastMove | undefined; quiet: boolean }) =>
        useMarvaCelebration(move, names, options.muted ?? false, quiet, horn),
      { initialProps: { move: initial, quiet: options.quiet ?? false } },
    );
    return { ...utils, horn };
  }

  it("celebrates a Marva move as it arrives: the voice, then the horn", () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    try {
      const { result, rerender, horn } = hook(meld(1));
      expect(result.current.shown).toBeNull();
      rerender({ move: meld(2, true), quiet: false });
      expect(result.current.shown).toEqual({ seq: 2, name: "Ben" });
      expect(speech.said).toEqual(["Marva Rule"]);
      expect(horn).not.toHaveBeenCalled();
      act(() => speech.finish());
      expect(horn).toHaveBeenCalledTimes(1);
      // The same move arriving again with the next view is not news twice.
      rerender({ move: meld(2, true), quiet: false });
      expect(speech.said).toHaveLength(1);
      act(() => vi.advanceTimersByTime(MARVA_MS));
      expect(result.current.shown).toBeNull();
    } finally {
      speech.restore();
    }
  });

  it("can be put away early, which stops the voice and the horn that was to follow", () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    try {
      const { result, rerender, horn } = hook(meld(1));
      rerender({ move: meld(2, true), quiet: false });
      const before = speech.cancels();
      act(() => result.current.dismiss());
      expect(result.current.shown).toBeNull();
      expect(speech.cancels()).toBe(before + 1);
      // Neither the cut-off line nor the give-up timer brings the horn.
      act(() => vi.advanceTimersByTime(SPEECH_GIVE_UP_MS + MARVA_MS));
      expect(horn).not.toHaveBeenCalled();
      // The next one is celebrated as ever, for its full time.
      rerender({ move: meld(3, true), quiet: false });
      act(() => vi.advanceTimersByTime(MARVA_MS - 1));
      expect(result.current.shown).toEqual({ seq: 3, name: "Ben" });
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.shown).toBeNull();
    } finally {
      speech.restore();
    }
  });

  it("is dismissed by a click or Escape only after its entrance", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<MarvaCelebration news={{ seq: 1, name: "Ben" }} onDismiss={onDismiss} />);
    const overlay = screen.getByRole("status", { name: "Marva Rule" }).parentElement!;
    fireEvent.click(overlay);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay).toHaveClass("pointer-events-none");
    act(() => vi.advanceTimersByTime(CELEBRATION_DISMISS_AFTER_MS - 1));
    fireEvent.click(overlay);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    // Another key does nothing; Escape and a click each put it away.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(overlay);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("stays inert with nothing to dismiss it", () => {
    vi.useFakeTimers();
    const news = { seq: 1, name: "Ben" };
    const { rerender } = render(<MarvaCelebration news={news} />);
    act(() => vi.advanceTimersByTime(CELEBRATION_DISMISS_AFTER_MS));
    const overlay = screen.getByRole("status", { name: "Marva Rule" }).parentElement!;
    expect(overlay).toHaveClass("pointer-events-none");
    // Nor once a way to dismiss it is taken away again.
    rerender(<MarvaCelebration news={news} onDismiss={() => {}} />);
    act(() => vi.advanceTimersByTime(CELEBRATION_DISMISS_AFTER_MS));
    expect(overlay).not.toHaveClass("pointer-events-none");
    rerender(<MarvaCelebration news={news} />);
    expect(overlay).toHaveClass("pointer-events-none");
  });

  it("stops a line before it starts, when the voices have not loaded yet", () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    const synth = window.speechSynthesis as unknown as Record<string, unknown>;
    let voices: { name: string }[] = [];
    const listeners: (() => void)[] = [];
    synth.getVoices = () => voices;
    synth.addEventListener = (_: string, fn: () => void) => listeners.push(fn);
    synth.removeEventListener = () => {};
    try {
      const after = vi.fn();
      const stop = sayDeep("Marva Rule", after);
      stop();
      act(() => vi.advanceTimersByTime(SPEECH_GIVE_UP_MS * 2));
      // Voices arriving afterwards do not start it either.
      voices = [{ name: "Daniel" }];
      for (const fn of listeners) fn();
      expect(speech.said).toEqual([]);
      expect(after).not.toHaveBeenCalled();
      // Nothing was speaking, so nothing (perhaps someone else's line) was cut off.
      expect(speech.cancels()).toBe(0);
    } finally {
      speech.restore();
    }
  });

  it("is old news on the move a page opens on", () => {
    const { result } = hook(meld(5, true));
    expect(result.current.shown).toBeNull();
  });

  it("says nothing for an ordinary lay-down", () => {
    const { result, rerender } = hook(meld(1));
    rerender({ move: meld(2), quiet: false });
    expect(result.current.shown).toBeNull();
  });

  it("is shown but not heard when muted", () => {
    const speech = fakeSpeech();
    try {
      const { result, rerender, horn } = hook(undefined, { muted: true });
      rerender({ move: meld(2, true), quiet: false });
      expect(result.current.shown?.name).toBe("Ben");
      expect(speech.said).toEqual([]);
      expect(horn).not.toHaveBeenCalled();
    } finally {
      speech.restore();
    }
  });

  it("is passed over when a replay jumps past it", () => {
    const { result, rerender } = hook(undefined);
    rerender({ move: meld(2, true), quiet: true });
    expect(result.current.shown).toBeNull();
  });

  it("shows the rule's name and who used it, over confetti", () => {
    const { container } = render(<MarvaCelebration news={{ seq: 1, name: "Ben" }} />);
    const panel = screen.getByRole("status", { name: "Marva Rule" });
    expect(panel).toHaveTextContent("Marva Rule");
    expect(panel).toHaveTextContent("Ben got down with the Marva Rule");
    expect(container.querySelectorAll(".confetti-piece")).toHaveLength(CONFETTI_PIECES);
  });

  it("draws the same confetti on every screen, spread across it", () => {
    const pieces = confettiPieces();
    expect(pieces).toEqual(confettiPieces());
    expect(pieces).toHaveLength(80);
    expect(Math.min(...pieces.map((p) => p.left))).toBeLessThan(10);
    expect(Math.max(...pieces.map((p) => p.left))).toBeGreaterThan(90);
  });
});
