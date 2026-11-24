import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimeline, heuristicPolicy, replay } from "@hf/engine";
import {
  EAST_COAST,
  jsonBytes,
  MAX_REPORT_BODY_BYTES,
  MAX_REPORT_BYTES,
  REMOVED,
  REPORT_TEXT_MAX,
  REPORTS_PATH,
  TRUNCATED,
  type BugReport,
  type ReportTable,
} from "@hf/shared";
import { FakeClock } from "./clock";
import { createServer, type HandAndFootServer } from "./index";
import {
  bearerMatches,
  InMemoryReportStore,
  NO_TABLE,
  parseAfter,
  parseReport,
  parseSince,
  reportEntry,
  reportMarkdown,
  reportReplay,
  reportRoomCode,
  REPORTS_KEPT,
  REPORTS_PER_READ,
  reportsMarkdown,
  tableForReport,
  type ReportDraft,
} from "./reports";
import { Room } from "./room";

const T = 1_800_000_000_000;

/** A two-seat table that has dealt and played `moves` moves, with a line of chat. */
function playedRoom(moves = 30): Room {
  let n = 0;
  const room = new Room("ABC234", EAST_COAST, {
    clock: new FakeClock(T),
    seed: 11,
    uid: "uid-1",
    newToken: () => `seat-tok-${n++}-0123456789abcdef`,
  });
  room.join("ana", { userId: "ana-user-000000001" });
  room.join("ben");
  room.start(room.hostSeat);
  for (let i = 0; i < moves; i++) {
    const state = room.gameState!;
    if (state.roundEnded) break;
    const action = heuristicPolicy(state, state.currentSeat);
    if (!action) break;
    const done = room.submitAction(state.currentSeat, action);
    if (!done.ok) throw new Error(done.error);
  }
  room.chat(0, "good luck");
  return room;
}

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return { at: T, text: "the pile vanished", context: {}, room: null, ...overrides };
}

describe("the report limits", () => {
  it("are 2000 characters, 256 KB sent, 512 KB kept, the newest 200, 16 a read", () => {
    expect([REPORT_TEXT_MAX, MAX_REPORT_BODY_BYTES, MAX_REPORT_BYTES]).toEqual([
      2000, 262_144, 524_288,
    ]);
    expect([REPORTS_KEPT, REPORTS_PER_READ]).toEqual([200, 16]);
    expect(REPORTS_PATH).toBe("/api/reports");
  });
});

describe("parseReport", () => {
  it("keeps the trimmed text, the attachment, the time and the table named", () => {
    expect(
      parseReport({ text: "  the pile vanished \n", room: " abc234", context: { seat: 1 } }, T),
    ).toEqual({
      ok: true,
      data: { at: T, text: "the pile vanished", context: { seat: 1 }, room: "ABC234" },
    });
  });

  it("attaches nothing when the attachment is absent or null, and names no table", () => {
    for (const context of [undefined, null]) {
      expect(parseReport({ text: "x", context }, T)).toEqual({
        ok: true,
        data: { at: T, text: "x", context: {}, room: null },
      });
    }
  });

  it("names a table only by a well-formed code", () => {
    expect(reportRoomCode("abc234")).toBe("ABC234");
    for (const raw of [undefined, 7, "", "ABC23", "ABC2345", "ABC10I", "../x/1", "ABC 23"]) {
      expect(reportRoomCode(raw)).toBeNull();
    }
  });

  it("removes every secret from the attachment, whatever the client did", () => {
    const parsed = parseReport(
      {
        text: "x",
        context: {
          storage: { "hf.seat": { roomId: "ABC234", seat: 0, token: "seat-tok-leaked-000001" } },
          identity: { userId: "ana", secret: "s".repeat(43) },
          console: ["resume seat-tok-leaked-000001"],
        },
      },
      T,
    );
    expect(parsed.ok).toBe(true);
    const json = JSON.stringify(parsed.ok && parsed.data);
    expect(json).not.toContain("seat-tok-leaked-000001");
    expect(json).not.toContain("s".repeat(43));
    expect(parsed.ok && parsed.data.context.identity).toEqual({ userId: "ana", secret: REMOVED });
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

  it("refuses a report over 256 KB of JSON, counted in UTF-8 bytes", () => {
    const filler = (n: number) => ({ text: "x", context: { pad: "a".repeat(n) } });
    // Find the largest pad that fits exactly, then go one byte over.
    const base = jsonBytes({ at: T, ...filler(0) });
    const fits = MAX_REPORT_BODY_BYTES - base;
    expect(parseReport(filler(fits), T).ok).toBe(true);
    expect(parseReport(filler(fits + 1), T)).toEqual({
      ok: false,
      error: "that report has too much attached",
    });
    // A three-byte character counts three times, not once.
    expect(
      parseReport({ text: "x", context: { pad: "€".repeat(Math.ceil(fits / 3) + 1) } }, T).ok,
    ).toBe(false);
  });
});

describe("tableForReport", () => {
  it("carries the whole table but no seat's token", () => {
    const room = playedRoom();
    const { record, tokens } = tableForReport(room);
    expect(tokens).toEqual(room.seats().map((p) => p.token));
    expect(tokens.every((t) => t.length > 8)).toBe(true);
    const json = JSON.stringify(record);
    for (const token of tokens) expect(json).not.toContain(token);
    expect(json).not.toMatch(/token/i);
    expect(record).toMatchObject({
      code: "ABC234",
      uid: "uid-1",
      config: EAST_COAST,
      seed: 11,
      started: true,
      hostSeat: 0,
      pausedSeat: null,
      idlePaused: false,
      savedUntil: null,
      nextRoundReady: [],
      wentOn: [],
      nextRoomId: null,
    });
    expect(record.players).toEqual([
      expect.objectContaining({ seat: 0, name: "ana", host: true, userId: "ana-user-000000001" }),
      expect.objectContaining({ seat: 1, name: "ben", host: false }),
    ]);
    expect(record.players[0]).toHaveProperty("connected");
    expect(record.actions.length).toBeGreaterThan(10);
    expect(record.actions[0]).toMatchObject({ seq: 0, source: "player" });
    expect(record.state).toEqual(room.gameState);
    expect(record.chat).toMatchObject([{ seat: 0, text: "good luck" }]);
  });

  it("names who is ready, and who went on, by seat", () => {
    const room = playedRoom(0);
    const ready = room.record().players.map((p) => p.token);
    vi.spyOn(room, "record").mockReturnValue({
      ...room.record(),
      nextRoundReady: [ready[1]!],
      wentOn: [ready[0]!, "someone-gone-000000"],
      idlePaused: true,
      pausedSince: T,
      savedUntil: T + 1,
    });
    const { record } = tableForReport(room);
    expect(record).toMatchObject({
      nextRoundReady: [1],
      wentOn: [0, -1],
      idlePaused: true,
      pausedSince: T,
      savedUntil: T + 1,
    });
  });

  it("replays to exactly the state it carries, through the engine", () => {
    const room = playedRoom(40);
    const { record } = tableForReport(room);
    const report: BugReport = {
      id: 0,
      ...reportEntry(draft({ room: "ABC234" }), { code: "ABC234", attached: true, record })!,
    };
    const log = reportReplay(report)!;
    expect(log.setup).toEqual({ seed: 11, playerCount: 2, firstSeat: record.firstSeat });
    expect(log.names).toEqual(["ana", "ben"]);
    const timeline = buildTimeline(log);
    expect(timeline.stateAt(timeline.length)).toEqual(record.state);
    const { seed, playerCount, firstSeat } = log.setup as {
      seed: number;
      playerCount: number;
      firstSeat: number;
    };
    expect(replay(seed, playerCount, log.config, log.actions, firstSeat)).toEqual(record.state);
  });
});

describe("reportEntry", () => {
  it("attaches the table and clears that table's tokens from the whole report", () => {
    const room = playedRoom();
    const { record, tokens } = tableForReport(room);
    const entry = reportEntry(
      draft({ room: "ABC234", context: { console: [`seat ${tokens[1]}`] } }),
      { code: "ABC234", attached: true, record },
      tokens,
    )!;
    expect(entry.table).toEqual({ code: "ABC234", attached: true, record });
    expect(entry.context).toEqual({ console: [`seat ${REMOVED}`] });
    expect(entry).not.toHaveProperty("truncated");
    expect(entry).not.toHaveProperty("room");
    for (const token of tokens) expect(JSON.stringify(entry)).not.toContain(token);
  });

  it("keeps a report whose table is missing, saying why", () => {
    const missing: ReportTable = { code: "ZZZ222", attached: false, reason: NO_TABLE };
    expect(reportEntry(draft({ room: "ZZZ222" }), missing)).toEqual({
      at: T,
      text: "the pile vanished",
      context: {},
      table: missing,
    });
    expect(reportEntry(draft(), null)).toEqual({ at: T, text: "the pile vanished", context: {} });
  });

  it("fits 512 KB by cutting the client's largest sections, then the chat, the moves and the state last", () => {
    const { record } = tableForReport(playedRoom(60));
    const table: ReportTable = { code: "ABC234", attached: true, record };
    const frames = Array.from({ length: 700 }, (_, i) => ({ i, pad: "f".repeat(1_000) }));
    const big = draft({
      context: { logs: { frames, console: ["one line"] }, page: { build: "abc" } },
    });
    const entry = reportEntry(big, table)!;
    expect(jsonBytes(entry)).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(entry.table).toEqual(table);
    const logs = entry.context.logs as { frames: unknown[]; console: unknown[] };
    expect(logs.frames.length).toBeLessThan(700);
    expect(logs.frames.at(-1)).toEqual(frames.at(-1));
    expect(logs.console).toEqual(["one line"]);
    expect(entry.truncated).toEqual([
      {
        section: "context.logs.frames",
        bytes: jsonBytes(frames),
        kept: logs.frames.length,
        of: 700,
      },
    ]);

    // A table record too large on its own: its moves are cut to a replayable start.
    const actions = Array.from({ length: 6_000 }, (_, seq) => ({
      ...record.actions[seq % record.actions.length]!,
      seq,
    }));
    const huge: ReportTable = { code: "ABC234", attached: true, record: { ...record, actions } };
    const cut = reportEntry(draft(), huge)!;
    expect(jsonBytes(cut)).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    const kept = (cut.table as unknown as { record: { actions: unknown[]; state: unknown } })
      .record;
    expect(kept.actions[0]).toEqual(actions[0]);
    expect(kept.actions.length).toBeLessThan(6_000);
    expect(kept.state).toEqual(record.state);
    // Only the chat and the moves: the rules and seats are what make the rest mean anything.
    expect(cut.truncated?.map((t) => t.section)).toEqual([
      "table.record.chat",
      "table.record.actions",
    ]);
    expect(kept).toMatchObject({ config: record.config, players: record.players });
  });

  it("answers null for a report that cannot fit even cut down", () => {
    const text = "x".repeat(MAX_REPORT_BYTES);
    expect(reportEntry(draft({ text }), null)).toBeNull();
  });
});

describe("InMemoryReportStore", () => {
  it("numbers reports in order and answers those after a time or a number, oldest first", async () => {
    const store = new InMemoryReportStore();
    const first = await store.add({ at: T, text: "a", context: {} });
    const second = await store.add({ at: T + 5, text: "b", context: {} });
    expect([first.id, second.id]).toEqual([0, 1]);
    expect(await store.since(0)).toEqual([first, second]);
    expect(await store.since(T)).toEqual([second]);
    expect(await store.since(T + 5)).toEqual([]);
    expect(await store.since(0, 0)).toEqual([second]);
  });

  it("keeps the newest 200, dropping the oldest first, and answers 16 at a time", async () => {
    const store = new InMemoryReportStore();
    for (let i = 0; i < 202; i++) await store.add({ at: T + i, text: `r${i}`, context: {} });
    const page = await store.since(0);
    expect(page.length).toBe(16);
    expect(page[0]!.id).toBe(2);
    const last = await store.since(0, 190);
    expect(last.map((r) => r.id)).toEqual([...Array(11).keys()].map((i) => 191 + i));
  });
});

describe("parseSince and parseAfter", () => {
  it("read whole numbers and treat anything else as from the start", () => {
    expect(parseSince("1700")).toBe(1700);
    expect(parseAfter("12")).toBe(12);
    for (const raw of [null, "", "-5", "1.5", "1e3", "abc"]) {
      expect(parseSince(raw)).toBe(0);
      expect(parseAfter(raw)).toBe(-1);
    }
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

  it("writes a summary first, then every section folded with its size", () => {
    const { record } = tableForReport(playedRoom(10));
    const report: BugReport = {
      id: 3,
      at: Date.UTC(2026, 10, 20, 12),
      text: "it froze\n\nafter a pile",
      context: {
        summary: { build: "abc1234", room: "ABC234", seat: 1 },
        logs: { frames: [{ at: 1 }] },
        truncated: [{ section: "logs.frames", bytes: 900_000, kept: 12, of: 200 }],
      },
      table: { code: "ABC234", attached: true, record },
      truncated: [{ section: "context.storage", bytes: 70_000 }],
    };
    const text = reportMarkdown(report);
    const state = record.state!;
    expect(
      text.startsWith(
        [
          "## Report 3, 2026-11-20T12:00:00.000Z",
          "",
          "> it froze",
          ">",
          "> after a pile",
          "",
          "- **build:** abc1234",
          "- **room:** ABC234",
          "- **seat:** 1",
          `- **Table record:** ABC234, attached: 2 seats, seed 11, ${record.actions.length} moves, round ${state.roundNumber}, ${state.phase} phase, seat ${state.currentSeat} to play`,
          "- **Truncated to fit:** context.storage (all 70000 bytes)",
          "- **Cut by the client:** logs.frames (kept 12 of 200)",
          "",
          "<details><summary>context.logs (1 KB)</summary>",
          "",
          "```json",
        ].join("\n"),
      ),
    ).toBe(true);
    for (const section of ["config", "players", "actions", "state", "chat"]) {
      expect(text).toMatch(
        new RegExp(`<details><summary>table\\.${section} \\(\\d+ KB\\)</summary>`),
      );
    }
    expect(text).not.toContain("<summary>context.summary");
    expect(text).not.toContain("<summary>context.truncated");
    expect(text.endsWith("</details>\n")).toBe(true);
  });

  it("says when a table's record is missing, and prints a report with nothing attached plainly", () => {
    const missing = reportMarkdown({
      id: 0,
      at: T,
      text: "x",
      context: {},
      table: { code: "ZZZ222", attached: false, reason: NO_TABLE },
    });
    expect(missing).toContain(`- **Table record:** ZZZ222, not attached: ${NO_TABLE}`);
    expect(
      reportsMarkdown([{ id: 4, at: Date.UTC(2026, 10, 20, 13), text: "no sound", context: {} }]),
    ).toBe("## Report 4, 2026-11-20T13:00:00.000Z\n\n> no sound\n");
  });

  it("survives a client-sent truncated that is not a list, and a table record cut to a string", () => {
    const { record } = tableForReport(playedRoom(10));
    const text = reportMarkdown({
      id: 0,
      at: T,
      text: "x",
      context: { truncated: "everything", other: 1 },
      table: {
        code: "ABC234",
        attached: true,
        record: { ...record, players: TRUNCATED as never, config: TRUNCATED as never },
      },
    });
    expect(text).toContain("attached: cut seats");
    expect(text).not.toContain("Cut by the client");
    const entries = reportMarkdown({
      id: 0,
      at: T,
      text: "x",
      context: { truncated: [null, 5, { section: "a", bytes: 3 }, { section: 1 }] },
    });
    expect(entries).toContain("- **Cut by the client:** a (all 3 bytes)");
  });

  it("fences details with more backticks than they hold", () => {
    const text = reportsMarkdown([{ id: 0, at: T, text: "x", context: { note: "````" } }]);
    expect(text).toContain('\n`````json\n"````"\n`````\n');
  });
});

describe("reportReplay", () => {
  it("is null without a dealt table's record", () => {
    const base = { id: 0, at: T, text: "x", context: {} };
    expect(reportReplay(base)).toBeNull();
    expect(
      reportReplay({ ...base, table: { code: "ZZZ222", attached: false, reason: NO_TABLE } }),
    ).toBeNull();
    const { record } = tableForReport(playedRoom(0));
    expect(
      reportReplay({
        ...base,
        table: {
          code: "ABC234",
          attached: true,
          record: { ...record, players: TRUNCATED as never },
        },
      }),
    ).toBeNull();
    expect(
      reportReplay({
        ...base,
        table: { code: "ABC234", attached: true, record: { ...record, started: false } },
      }),
    ).toBeNull();
  });
});

describe("POST /api/reports on the Node host", () => {
  let server: HandAndFootServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.restoreAllMocks();
  });

  it("keeps a report with its open table attached, logs a line, and refuses one that does not pass", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const reports = new InMemoryReportStore();
    server = createServer({ reports });
    const port = await server.listen(0);
    const room = server.manager.create(EAST_COAST);
    const ana = room.join("ana");
    room.join("ben");
    room.start(room.hostSeat);
    const token = ana.ok ? ana.value.token : "";
    const send = async (body: unknown) =>
      (
        await fetch(`http://localhost:${port}${REPORTS_PATH}`, {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).json();
    expect(
      await send({
        text: " cards vanished ",
        room: room.id.toLowerCase(),
        context: { said: `my seat is ${token}` },
      }),
    ).toEqual({ ok: true, data: { id: 0 } });
    expect(await send({ text: "elsewhere", room: "ZZZ222" })).toEqual({
      ok: true,
      data: { id: 1 },
    });
    expect(await send({ text: "" })).toEqual({ ok: false, error: "say what went wrong" });
    const [kept, gone] = await reports.since(0);
    expect(kept).toMatchObject({
      id: 0,
      text: "cards vanished",
      context: { said: `my seat is ${REMOVED}` },
    });
    expect(kept!.table).toMatchObject({
      code: room.id,
      attached: true,
      record: { seed: room.record().seed },
    });
    expect(JSON.stringify(kept)).not.toContain(token);
    expect(gone!.table).toEqual({ code: "ZZZ222", attached: false, reason: NO_TABLE });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      `bug report 0: ${jsonBytes(kept)} bytes, table ${room.id}: cards vanished`,
    );
  });

  it("reads a report body up to twice the cap, and refuses one too large", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    server = createServer();
    const port = await server.listen(0);
    const send = async (pad: number) =>
      fetch(`http://localhost:${port}${REPORTS_PATH}`, {
        method: "POST",
        body: JSON.stringify({ text: "x", context: { pad: "a".repeat(pad) } }),
      });
    const over = await send(MAX_REPORT_BODY_BYTES);
    expect(over.status).toBe(200);
    expect(await over.json()).toEqual({ ok: false, error: "that report has too much attached" });
    expect((await send(2 * MAX_REPORT_BODY_BYTES)).status).toBe(400);
    expect(await (await send(1_000)).json()).toEqual({ ok: true, data: { id: 0 } });
  });
});
