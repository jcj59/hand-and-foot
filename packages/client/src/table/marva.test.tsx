import { afterEach, describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { LastMove } from "@hf/shared";
import { CONFETTI_PIECES, confettiPieces } from "./Celebration";
import { SPEECH_GIVE_UP_MS, sayDeep } from "./grabby";
import { MARVA_MS, MarvaCelebration, useMarvaCelebration } from "./marva";

/** A speech engine that records what it is asked to say and finishes on demand. */
function fakeSpeech(): {
  said: string[];
  finish: () => void;
  restore: () => void;
} {
  const said: string[] = [];
  let last: { onend: (() => void) | null } | null = null;
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
      cancel: () => {},
      getVoices: () => [{ name: "Daniel" }],
    },
  });
  return {
    said,
    finish: () => last?.onend?.(),
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
      expect(result.current).toBeNull();
      rerender({ move: meld(2, true), quiet: false });
      expect(result.current).toEqual({ seq: 2, name: "Ben" });
      expect(speech.said).toEqual(["Marva Rule"]);
      expect(horn).not.toHaveBeenCalled();
      act(() => speech.finish());
      expect(horn).toHaveBeenCalledTimes(1);
      // The same move arriving again with the next view is not news twice.
      rerender({ move: meld(2, true), quiet: false });
      expect(speech.said).toHaveLength(1);
      act(() => vi.advanceTimersByTime(MARVA_MS));
      expect(result.current).toBeNull();
    } finally {
      speech.restore();
    }
  });

  it("is old news on the move a page opens on", () => {
    const { result } = hook(meld(5, true));
    expect(result.current).toBeNull();
  });

  it("says nothing for an ordinary lay-down", () => {
    const { result, rerender } = hook(meld(1));
    rerender({ move: meld(2), quiet: false });
    expect(result.current).toBeNull();
  });

  it("is shown but not heard when muted", () => {
    const speech = fakeSpeech();
    try {
      const { result, rerender, horn } = hook(undefined, { muted: true });
      rerender({ move: meld(2, true), quiet: false });
      expect(result.current?.name).toBe("Ben");
      expect(speech.said).toEqual([]);
      expect(horn).not.toHaveBeenCalled();
    } finally {
      speech.restore();
    }
  });

  it("is passed over when a replay jumps past it", () => {
    const { result, rerender } = hook(undefined);
    rerender({ move: meld(2, true), quiet: true });
    expect(result.current).toBeNull();
  });

  it("shows the rule's name and who used it, over confetti", () => {
    const { container } = render(<MarvaCelebration news={{ seq: 1, name: "Ben" }} />);
    const panel = screen.getByRole("status", { name: "Marva Rule" });
    expect(panel).toHaveTextContent("Marva Rule");
    expect(panel).toHaveTextContent("Ben got down by emptying the hand");
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
