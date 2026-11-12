import { afterEach, describe, expect, it, vi } from "vitest";
import { MATCHES_PATH, type Ack, type MatchHistory } from "@hf/shared";
import { forgetHistory, HISTORY_FRESH_MS, loadHistory } from "./historyCache";
import type { Post } from "./identity";

const ana = { userId: "a".repeat(16), secret: "s".repeat(32) };
const ben = { userId: "b".repeat(16), secret: "t".repeat(32) };

function historyOf(played: number): MatchHistory {
  return { stats: { played } as MatchHistory["stats"], recent: [] };
}

/** A server that answers each ask with the next answer, counting asks. */
function server(...answers: (Ack<unknown> | Error)[]): { post: Post; asks: unknown[][] } {
  const asks: unknown[][] = [];
  const post: Post = async (path, body) => {
    asks.push([path, body]);
    const answer = answers[Math.min(asks.length - 1, answers.length - 1)]!;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { post, asks };
}

const T = 1_800_000_000_000;

afterEach(() => vi.restoreAllMocks());

describe("the kept history", () => {
  it("asks the server for this identity's matches, and keeps the answer for a minute", async () => {
    const { post, asks } = server(
      { ok: true, data: historyOf(3) },
      { ok: true, data: historyOf(4) },
    );
    expect(await loadHistory(post, ana, T)).toEqual({ ok: true, data: historyOf(3) });
    expect(asks).toEqual([[MATCHES_PATH, { user: ana }]]);
    expect(await loadHistory(post, ana, T + HISTORY_FRESH_MS - 1)).toEqual({
      ok: true,
      data: historyOf(3),
    });
    expect(asks).toHaveLength(1);
    expect(await loadHistory(post, ana, T + HISTORY_FRESH_MS)).toEqual({
      ok: true,
      data: historyOf(4),
    });
    expect(asks).toHaveLength(2);
  });

  it("keeps it for one minute exactly", () => {
    expect(HISTORY_FRESH_MS).toBe(60_000);
  });

  it("shares an ask still on its way rather than sending another", async () => {
    const { post, asks } = server({ ok: true, data: historyOf(1) });
    const first = loadHistory(post, ana, T);
    const second = loadHistory(post, ana, T + 5);
    expect(asks).toHaveLength(1);
    expect(await second).toEqual(await first);
  });

  it("keeps each identity's apart", async () => {
    const { post, asks } = server(
      { ok: true, data: historyOf(1) },
      { ok: true, data: historyOf(2) },
    );
    await loadHistory(post, ana, T);
    expect(await loadHistory(post, ben, T)).toEqual({ ok: true, data: historyOf(2) });
    expect(asks.map(([, body]) => body)).toEqual([{ user: ana }, { user: ben }]);
  });

  it("keeps a refusal for the minute too, so nothing asks again in a loop", async () => {
    const tooMany = { ok: false as const, error: "too many requests; try again in a minute" };
    const { post, asks } = server(tooMany, { ok: true, data: historyOf(2) });
    for (let i = 0; i < 50; i++) expect(await loadHistory(post, ana, T + i)).toEqual(tooMany);
    expect(asks).toHaveLength(1);
    // Not kept past a reload, though: only an answer worth showing is stored.
    expect(window.sessionStorage.length).toBe(0);
    expect(await loadHistory(post, ana, T + HISTORY_FRESH_MS)).toEqual({
      ok: true,
      data: historyOf(2),
    });
  });

  it("answers a server it cannot reach as a refusal, and keeps that for the minute", async () => {
    const { post, asks } = server(new Error("offline"));
    const unreachable = { ok: false, error: "could not reach the server; try again" };
    expect(await loadHistory(post, ana, T)).toEqual(unreachable);
    expect(await loadHistory(post, ana, T + 1)).toEqual(unreachable);
    expect(asks).toHaveLength(1);
  });

  it("outlives a reload of the page in the tab's session storage", async () => {
    const { post, asks } = server(
      { ok: true, data: historyOf(5) },
      { ok: true, data: historyOf(6) },
    );
    await loadHistory(post, ana, T);
    // A reload: memory is gone, session storage is not.
    const stored = Object.fromEntries(
      Array.from({ length: window.sessionStorage.length }, (_, i) => {
        const key = window.sessionStorage.key(i)!;
        return [key, window.sessionStorage.getItem(key)!];
      }),
    );
    forgetHistory();
    for (const [key, value] of Object.entries(stored)) window.sessionStorage.setItem(key, value);
    expect(await loadHistory(post, ana, T + HISTORY_FRESH_MS - 1)).toEqual({
      ok: true,
      data: historyOf(5),
    });
    expect(asks).toHaveLength(1);
    // Stale there too after the minute.
    forgetHistory();
    for (const [key, value] of Object.entries(stored)) window.sessionStorage.setItem(key, value);
    expect(await loadHistory(post, ana, T + HISTORY_FRESH_MS)).toEqual({
      ok: true,
      data: historyOf(6),
    });
  });

  it("does not trust a stored answer from the future, or one that is damaged", async () => {
    const { post, asks } = server({ ok: true, data: historyOf(7) });
    const key = `hf.history:${ana.userId}`;
    for (const raw of [
      JSON.stringify({ at: T + 10_000, history: historyOf(1) }),
      JSON.stringify({ at: String(T), history: historyOf(1) }),
      JSON.stringify({ at: T }),
      "{not json",
    ]) {
      forgetHistory();
      window.sessionStorage.setItem(key, raw);
      expect(await loadHistory(post, ana, T)).toEqual({ ok: true, data: historyOf(7) });
    }
    expect(asks).toHaveLength(4);
  });

  it("asks afresh once forgotten, and forgets only its own stored answers", async () => {
    const { post, asks } = server({ ok: true, data: historyOf(1) });
    window.sessionStorage.setItem("hf.seat", "kept");
    await loadHistory(post, ana, T);
    await loadHistory(post, ben, T);
    forgetHistory();
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem("hf.seat")).toBe("kept");
    await loadHistory(post, ana, T + 1);
    expect(asks).toHaveLength(3);
  });

  it("still keeps the answer in memory when storage is blocked", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { post, asks } = server({ ok: true, data: historyOf(1) });
    expect(await loadHistory(post, ana, T)).toEqual({ ok: true, data: historyOf(1) });
    expect(await loadHistory(post, ana, T + 1)).toEqual({ ok: true, data: historyOf(1) });
    expect(asks).toHaveLength(1);
    expect(() => forgetHistory()).not.toThrow();
    await loadHistory(post, ana, T + 2);
    expect(asks).toHaveLength(2);
  });

  it("does not keep an answer that arrives after it was forgotten", async () => {
    let answer: (reply: Ack<unknown>) => void = () => {};
    let asks = 0;
    const post: Post = (): Promise<Ack<unknown>> => {
      asks++;
      return new Promise((resolve) => (answer = resolve));
    };
    const first = loadHistory(post, ana, T);
    // Signed out, or a match ended, while the ask was on its way.
    forgetHistory();
    answer({ ok: true, data: historyOf(1) });
    expect(await first).toEqual({ ok: true, data: historyOf(1) });
    void loadHistory(post, ana, T + 1);
    expect(asks).toBe(2);
  });
});
