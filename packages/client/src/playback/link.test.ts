import { describe, it, expect } from "vitest";
import { scenarioById } from "@hf/scenarios";
import { timelineOf } from "../scenarios/catalog";
import { formatLink, parseLink, stepFor } from "./link";

const marva = timelineOf(scenarioById("marva")!);

describe("scenario links", () => {
  it("reads a moment, a step, a seat and every hand from the fragment", () => {
    expect(parseLink("#moment=getdown")).toEqual({ momentId: "getdown" });
    expect(parseLink("#step=12&seat=1&all=1")).toEqual({ step: 12, seat: 1, revealAll: true });
    expect(parseLink("step=3")).toEqual({ step: 3 });
    expect(parseLink("")).toEqual({});
    // Nonsense is ignored rather than guessed at.
    expect(parseLink("#step=-1&seat=x&all=yes&moment=")).toEqual({});
  });

  it("finds the step a link points at, a moment first, and nothing outside the game", () => {
    const getdown = marva.moments.find((m) => m.id === "getdown")!.step;
    expect(stepFor(marva, { momentId: "getdown" })).toBe(getdown);
    expect(stepFor(marva, { momentId: "getdown", step: 5 })).toBe(getdown);
    expect(stepFor(marva, { momentId: "nope", step: 5 })).toBe(5);
    expect(stepFor(marva, { step: marva.length })).toBe(marva.length);
    expect(stepFor(marva, { step: marva.length + 1 })).toBeUndefined();
    expect(stepFor(marva, {})).toBeUndefined();
  });

  it("writes a named moment where there is one, the step otherwise, and only what differs", () => {
    const getdown = marva.moments.find((m) => m.id === "getdown")!.step;
    expect(formatLink(marva, { step: getdown, seat: 0, revealAll: false }, 0)).toBe(
      "#moment=getdown",
    );
    expect(formatLink(marva, { step: 1, seat: 2, revealAll: true }, 0)).toBe(
      "#step=1&seat=2&all=1",
    );
    expect(formatLink(marva, { step: 1, seat: 2, revealAll: false }, 2)).toBe("#step=1");
    // What it writes, it reads back to the same place.
    const link = parseLink(formatLink(marva, { step: getdown, seat: 1, revealAll: false }, 0));
    expect(stepFor(marva, link)).toBe(getdown);
    expect(link.seat).toBe(1);
  });
});
