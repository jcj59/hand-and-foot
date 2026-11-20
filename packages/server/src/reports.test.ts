import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_REPORT_BYTES, REPORT_TEXT_MAX, REPORTS_PATH, type BugReport } from "@hf/shared";
import { createServer, type HandAndFootServer } from "./index";
import {
  bearerMatches,
  InMemoryReportStore,
  jsonBytes,
  parseReport,
  parseSince,
  REPORTS_KEPT,
  reportsMarkdown,
} from "./reports";

const T = 1_800_000_000_000;

describe("the report limits", () => {
  it("are 2000 characters of text, 8 KB of JSON a report, and the newest 500 kept", () => {
    expect([REPORT_TEXT_MAX, MAX_REPORT_BYTES, REPORTS_KEPT]).toEqual([2000, 8192, 500]);
    expect(REPORTS_PATH).toBe("/api/reports");
  });
});

describe("parseReport", () => {
  it("keeps the trimmed text, the attachment and the time", () => {
    expect(parseReport({ text: "  the pile vanished \n", context: { room: "ABC234" } }, T)).toEqual(
      { ok: true, data: { at: T, text: "the pile vanished", context: { room: "ABC234" } } },
    );
  });

  it("attaches nothing when the attachment is absent or null", () => {
    for (const context of [undefined, null]) {
      expect(parseReport({ text: "x", context }, T)).toEqual({
        ok: true,
        data: { at: T, text: "x", context: {} },
      });
    }
  });

  it("refuses a report with nothing written", () => {
    for (const text of [undefined, 3, "", "   \n\t"]) {
      expect(parseReport({ text }, T)).toEqual({ ok: false, error: "say what went wrong" });
    }
  });

  it("refuses text past 2000 characters, counted after trimming", () => {
    expect(parseReport({ text: ` ${"a".repeat(2000)} ` }, T).ok).toBe(true);
    expect(parseReport({ text: "a".repeat(2001) }, T)).toEqual({
      ok: false,
      error: "that report is longer than 2000 characters",
    });
  });

  it("refuses a body or attachment that is not an object", () => {
    const unreadable = { ok: false, error: "that report could not be read" };
    for (const body of [null, "text", [1], 7]) expect(parseReport(body, T)).toEqual(unreadable);
    for (const context of ["room ABC234", 4, [1, 2], true]) {
      expect(parseReport({ text: "x", context }, T)).toEqual(unreadable);
    }
  });

  it("refuses a report over 8 KB of JSON, counted in UTF-8 bytes", () => {
    const filler = (n: number) => ({ text: "x", context: { pad: "a".repeat(n) } });
    // Find the largest pad that fits exactly, then go one byte over.
    const base = jsonBytes({ at: T, ...filler(0) });
    const fits = MAX_REPORT_BYTES - base;
    expect(parseReport(filler(fits), T).ok).toBe(true);
    expect(parseReport(filler(fits + 1), T)).toEqual({
      ok: false,
      error: "that report has too much attached",
    });
    // A three-byte character counts three times, not once.
    expect(parseReport({ text: "x", context: { pad: "€".repeat(fits / 3 + 1) } }, T).ok).toBe(
      false,
    );
  });
});

describe("InMemoryReportStore", () => {
  it("numbers reports in order and answers those after a time, oldest first", async () => {
    const store = new InMemoryReportStore();
    const first = await store.add({ at: T, text: "a", context: {} });
    const second = await store.add({ at: T + 5, text: "b", context: {} });
    expect([first.id, second.id]).toEqual([0, 1]);
    expect(await store.since(0)).toEqual([first, second]);
    expect(await store.since(T)).toEqual([second]);
    expect(await store.since(T + 5)).toEqual([]);
  });

  it("keeps the newest 500, dropping the oldest first", async () => {
    const store = new InMemoryReportStore();
    for (let i = 0; i < 502; i++) await store.add({ at: T + i, text: `r${i}`, context: {} });
    const kept = await store.since(0);
    expect(kept.length).toBe(500);
    expect(kept[0]!.id).toBe(2);
    expect(kept.at(-1)!.id).toBe(501);
  });
});

describe("parseSince", () => {
  it("reads whole milliseconds and treats anything else as from the start", () => {
    expect(parseSince("1700")).toBe(1700);
    for (const raw of [null, "", "-5", "1.5", "1e3", "abc"]) expect(parseSince(raw)).toBe(0);
  });
});

describe("bearerMatches", () => {
  it("accepts only the exact bearer token", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    for (const header of [
      null,
      undefined,
      "",
      "s3cret",
      "Bearer s3cres",
      "Bearer s3cret ",
      "bearer s3cret",
    ]) {
      expect(bearerMatches(header, "s3cret")).toBe(false);
    }
  });
});

describe("reportsMarkdown", () => {
  it("says when there are none", () => {
    expect(reportsMarkdown([])).toBe("No bug reports.\n");
  });

  it("writes each report as a heading, its text quoted and its details as JSON", () => {
    const reports: BugReport[] = [
      {
        id: 3,
        at: Date.UTC(2026, 10, 20, 12),
        text: "it froze\n\nafter a pile",
        context: { room: "ABC234" },
      },
      { id: 4, at: Date.UTC(2026, 10, 20, 13), text: "no sound", context: {} },
    ];
    expect(reportsMarkdown(reports)).toBe(
      [
        "## Report 3, 2026-11-20T12:00:00.000Z",
        "",
        "> it froze",
        ">",
        "> after a pile",
        "",
        "```json",
        "{",
        '  "room": "ABC234"',
        "}",
        "```",
        "",
        "## Report 4, 2026-11-20T13:00:00.000Z",
        "",
        "> no sound",
        "",
      ].join("\n"),
    );
  });

  it("fences details with more backticks than they hold", () => {
    const text = reportsMarkdown([{ id: 0, at: T, text: "x", context: { note: "````" } }]);
    expect(text).toContain('\n`````json\n{\n  "note": "````"\n}\n`````\n');
  });
});

describe("POST /api/reports on the Node host", () => {
  let server: HandAndFootServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it("keeps a report, logs it once, and refuses one that does not pass", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const reports = new InMemoryReportStore();
    server = createServer({ reports });
    const port = await server.listen(0);
    const send = async (body: unknown) =>
      (
        await fetch(`http://localhost:${port}${REPORTS_PATH}`, {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).json();
    expect(await send({ text: " cards vanished ", context: { room: "ABC234" } })).toEqual({
      ok: true,
      data: { id: 0 },
    });
    expect(await send({ text: "" })).toEqual({ ok: false, error: "say what went wrong" });
    const kept = await reports.since(0);
    expect(kept).toMatchObject([{ id: 0, text: "cards vanished", context: { room: "ABC234" } }]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`bug report 0: ${JSON.stringify(kept[0])}`);
  });
});
