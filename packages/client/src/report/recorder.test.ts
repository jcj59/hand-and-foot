import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOVED } from "@hf/shared";
import {
  CONSOLE_KEPT,
  CONSOLE_LINE_MAX,
  describeArgument,
  FRAMES_KEPT,
  forgetRecords,
  installConsoleLog,
  installNoticeLog,
  noteConsole,
  noteFrame,
  noteNotice,
  NOTICES_KEPT,
  recentRecords,
} from "./recorder";

afterEach(forgetRecords);

const TOKEN = "Rk4nWp8sXq2vYz6tLm0c";

describe("the recorder's limits", () => {
  it("keeps 200 frames, 200 console lines of 2000 characters, and 50 notices", () => {
    expect([FRAMES_KEPT, CONSOLE_KEPT, CONSOLE_LINE_MAX, NOTICES_KEPT]).toEqual([
      200, 200, 2000, 50,
    ]);
  });
});

describe("socket frames", () => {
  it("are kept newest last, at most 200, each cleared of secrets as it is kept", () => {
    for (let i = 0; i < 205; i++) noteFrame("received", { event: "view", payload: { i } }, i);
    noteFrame(
      "sent",
      { id: 9, event: "resumeSeat", payload: { roomId: "ABC234", token: TOKEN } },
      300,
    );
    const { frames, secrets } = recentRecords();
    expect(frames).toHaveLength(200);
    expect(frames[0]).toEqual({
      at: 6,
      direction: "received",
      frame: { event: "view", payload: { i: 6 } },
    });
    expect(frames.at(-1)).toEqual({
      at: 300,
      direction: "sent",
      frame: { id: 9, event: "resumeSeat", payload: { roomId: "ABC234", token: REMOVED } },
    });
    expect(JSON.stringify(frames)).not.toContain(TOKEN);
    // The secret is remembered, apart, so a report can search for it elsewhere.
    expect(secrets).toEqual([TOKEN]);
  });

  it("never keeps the frame object the transport holds", () => {
    const frame = { ack: 1, result: { ok: true, data: { token: TOKEN } } };
    noteFrame("received", frame, 1);
    expect(frame.result.data.token).toBe(TOKEN);
  });
});

describe("console lines", () => {
  it("are every level, each argument as text, cut to 2000 characters", () => {
    noteConsole("log", ["a", 1, { b: true }, null, undefined], 1);
    noteConsole("error", [new Error("boom")], 2);
    noteConsole("warn", ["x".repeat(3_000)], 3);
    const [first, second, third] = recentRecords().console;
    expect(first).toEqual({ at: 1, level: "log", message: 'a 1 {"b":true} null undefined' });
    expect(second!.level).toBe("error");
    expect(second!.message).toMatch(/^Error: boom/);
    expect(third!.message).toHaveLength(2000);
    expect(third!.message.endsWith("…")).toBe(true);
  });

  it("describe what JSON cannot, and what cannot even be read", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeArgument(cyclic)).toBe("[object Object]");
    const hostile = {
      toJSON() {
        throw new Error("no");
      },
      toString() {
        throw new Error("no");
      },
    };
    expect(describeArgument(hostile)).toBe("[unreadable]");
    const bare = new Error("plain");
    bare.stack = undefined;
    expect(describeArgument(bare)).toBe("Error: plain");
    expect(describeArgument(Symbol.for("s"))).toBe("Symbol(s)");
  });

  it("keep the newest 200", () => {
    for (let i = 0; i < 201; i++) noteConsole("debug", [i], i);
    const lines = recentRecords().console;
    expect(lines).toHaveLength(200);
    expect(lines[0]!.message).toBe("1");
  });

  it("are recorded from the console itself, which still writes as before", () => {
    const written: unknown[][] = [];
    const target = {
      log: (...a: unknown[]) => written.push(["log", ...a]),
      info: (...a: unknown[]) => written.push(["info", ...a]),
      warn: (...a: unknown[]) => written.push(["warn", ...a]),
      error: (...a: unknown[]) => written.push(["error", ...a]),
      debug: (...a: unknown[]) => written.push(["debug", ...a]),
    };
    const originals = { ...target };
    const undo = installConsoleLog(target, () => 42);
    for (const level of ["log", "info", "warn", "error", "debug"] as const) target[level](level, 1);
    expect(written).toEqual([
      ["log", "log", 1],
      ["info", "info", 1],
      ["warn", "warn", 1],
      ["error", "error", 1],
      ["debug", "debug", 1],
    ]);
    expect(recentRecords().console.map((l) => [l.at, l.level, l.message])).toEqual([
      [42, "log", "log 1"],
      [42, "info", "info 1"],
      [42, "warn", "warn 1"],
      [42, "error", "error 1"],
      [42, "debug", "debug 1"],
    ]);
    undo();
    expect(target).toEqual(originals);
  });

  it("are written even when keeping one fails", () => {
    const write = vi.fn();
    const target = { log: write, info: write, warn: write, error: write, debug: write };
    const undo = installConsoleLog(target, () => {
      throw new Error("clock broke");
    });
    target.warn("still here");
    expect(write).toHaveBeenCalledWith("still here");
    undo();
  });
});

describe("notices", () => {
  it("are each new one a store puts up, newest 50", () => {
    let listener: ((s: { notice: string | null }, p: { notice: string | null }) => void) | null =
      null;
    const unsubscribe = vi.fn();
    const stop = installNoticeLog({
      subscribe: (l) => {
        listener = l;
        return unsubscribe;
      },
    });
    listener!({ notice: "it is not your turn" }, { notice: null });
    listener!({ notice: "it is not your turn" }, { notice: "it is not your turn" });
    listener!({ notice: null }, { notice: "it is not your turn" });
    listener!({ notice: "the table is paused" }, { notice: null });
    expect(recentRecords().notices.map((n) => n.text)).toEqual([
      "it is not your turn",
      "the table is paused",
    ]);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
    for (let i = 0; i < 51; i++) noteNotice(`n${i}`, i);
    expect(recentRecords().notices).toHaveLength(50);
    expect(recentRecords().notices[0]!.text).toBe("n1");
  });
});
