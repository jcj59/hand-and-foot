import { afterEach, describe, expect, it, vi } from "vitest";
import { LOOK_TIMEOUT_MS, lookUpTable, tableGone } from "./lookUp";

describe("lookUpTable", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the table's own path", async () => {
    const asked: string[] = [];
    await lookUpTable("ABC234", async (path) => {
      asked.push(path);
      return { ok: true, data: { started: false } };
    });
    expect(asked).toEqual(["/api/rooms/ABC234"]);
  });

  it("reads an open table as open, started or not", async () => {
    expect(await lookUpTable("ABC234", async () => ({ ok: true, data: { started: true } }))).toBe(
      "open",
    );
  });

  it("reads the server's no-table refusal, and only that, as gone", async () => {
    const refusal = { ok: false, error: "no room with that code" };
    expect(await lookUpTable("ABC234", async () => refusal)).toBe("gone");
    expect(await lookUpTable("ABC234", async () => ({ ok: false, error: "busy" }))).toBe("unknown");
  });

  it("treats no answer, or one it cannot read, as unknown rather than gone", async () => {
    // A blip must never tell a player their table has closed.
    expect(
      await lookUpTable("ABC234", async () => {
        throw new Error("offline");
      }),
    ).toBe("unknown");
    expect(await lookUpTable("ABC234", async () => null)).toBe("unknown");
    expect(await lookUpTable("ABC234", async () => "<html>")).toBe("unknown");
  });

  it("gives up on a look that never answers, as unknown", async () => {
    vi.useFakeTimers();
    let settled: string | null = null;
    void lookUpTable("ABC234", () => new Promise(() => {})).then((s) => (settled = s));
    await vi.advanceTimersByTimeAsync(LOOK_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe("unknown");
  });

  it("waits three seconds for the answer", () => {
    expect(LOOK_TIMEOUT_MS).toBe(3000);
  });

  it("says which table has closed", () => {
    expect(tableGone("ABC234")).toBe("Table ABC234 has closed, or the link is wrong.");
  });
});
