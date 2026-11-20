/**
 * Bug reports on the Worker: sent over HTTP as the client sends them, kept in the
 * one reports object, capped, rate limited before the object is asked, and read
 * back only with the token. Worker test storage outlives a test, so each test
 * finds its own reports by their text or address rather than counting them all.
 */
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { REPORTS_PATH, type Ack, type BugReport } from "@hf/shared";
import worker from "../src/index";
import { REPORT_LIMIT, REPORT_WINDOW_MS, reportKey } from "../src/limits";
import { REPORTS_OBJECT, type ReportsObject } from "../src/reports";

const BASE = "http://game.example";
const TOKEN = "test-reports-token";

function send(body: unknown, address = "203.0.113.1"): Promise<Response> {
  return SELF.fetch(`${BASE}${REPORTS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": address },
    body: JSON.stringify(body),
  });
}

async function read(since = 0, token: string | null = TOKEN): Promise<Response> {
  return SELF.fetch(`${BASE}${REPORTS_PATH}?since=${since}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

async function kept(): Promise<BugReport[]> {
  const answer = (await (await read()).json()) as Ack<BugReport[]>;
  if (!answer.ok) throw new Error(answer.error);
  return answer.data;
}

describe("bug reports", () => {
  it("allows 5 reports an hour per sender, by address, else by the id attached", () => {
    expect([REPORT_LIMIT, REPORT_WINDOW_MS]).toEqual([5, 3_600_000]);
    expect(reportKey("198.51.100.4", "ana-reports-00001")).toBe("ip:198.51.100.4");
    expect(reportKey(null, "ana-reports-00001")).toBe("user:ana-reports-00001");
    expect(reportKey(null, "../x")).toBe("anonymous");
    expect(reportKey("", undefined)).toBe("anonymous");
  });

  it("keeps a report sent over HTTP and reads it back with the token", async () => {
    const before = Date.now() - 1;
    const response = await send(
      { text: "  the pile vanished  ", context: { room: "ABC234", seat: 1 } },
      "203.0.113.10",
    );
    expect(response.status).toBe(200);
    const answer = (await response.json()) as Ack<{ id: number }>;
    expect(answer.ok).toBe(true);
    const mine = (await kept()).find((r) => r.text === "the pile vanished");
    expect(mine).toMatchObject({ context: { room: "ABC234", seat: 1 } });
    expect(answer.ok && mine?.id).toBe(answer.ok && answer.data.id);
    expect(mine!.at).toBeGreaterThan(before);
    // Only those after `since`.
    const later = (await (await read(mine!.at)).json()) as Ack<BugReport[]>;
    expect(later.ok && later.data.some((r) => r.id === mine!.id)).toBe(false);
  });

  it("refuses a report that does not pass, without keeping it or counting it", async () => {
    const address = "203.0.113.20";
    expect(await (await send({ text: " " }, address)).json()).toEqual({
      ok: false,
      error: "say what went wrong",
    });
    expect(await (await send({ text: "x", context: "no" }, address)).json()).toEqual({
      ok: false,
      error: "that report could not be read",
    });
    const notJson = await SELF.fetch(`${BASE}${REPORTS_PATH}`, { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
    // None of those counted: five real ones still go through.
    for (let i = 0; i < 5; i++) {
      expect(((await (await send({ text: `counted ${i}` }, address)).json()) as Ack).ok).toBe(true);
    }
  });

  it("refuses a sender's sixth report in an hour without asking the reports object", async () => {
    const address = "203.0.113.30";
    for (let i = 0; i < 5; i++) {
      expect((await send({ text: `limit ${i}` }, address)).status).toBe(200);
    }
    const stub = env.REPORTS.getByName(REPORTS_OBJECT);
    const nextBefore = await runInDurableObject(stub, (_, state) => state.storage.kv.get("next"));
    const refused = await send({ text: "limit 5" }, address);
    expect(refused.status).toBe(429);
    const wait = Number(refused.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(3_500);
    expect(wait).toBeLessThanOrEqual(3_600);
    expect(await refused.json()).toEqual({
      ok: false,
      error: "too many reports; try again in an hour",
    });
    expect(await runInDurableObject(stub, (_, state) => state.storage.kv.get("next"))).toBe(
      nextBefore,
    );
    expect((await kept()).some((r) => r.text === "limit 5")).toBe(false);
    // Someone else reports on as usual.
    expect((await send({ text: "another sender" }, "203.0.113.31")).status).toBe(200);
  });

  it("keeps the newest 500, dropping the oldest first", async () => {
    const stub = env.REPORTS.getByName(REPORTS_OBJECT);
    const ids = await runInDurableObject(stub, (object: ReportsObject) => {
      const added: number[] = [];
      for (let i = 0; i < 505; i++) {
        added.push(object.add({ at: 1, text: `cap ${i}`, context: {} }));
      }
      return added;
    });
    const all = await kept();
    expect(all.length).toBe(500);
    expect(all.map((r) => r.id)).toEqual(ids.slice(5));
    expect(all.some((r) => r.text === "cap 4")).toBe(false);
    expect(all[0]!.text).toBe("cap 5");
  });

  it("is read only with the token", async () => {
    for (const token of [null, "wrong", `${TOKEN}x`]) {
      const refused = await read(0, token);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ ok: false, error: "that is not the reports token" });
    }
  });

  it("cannot be read at all while no token is set", async () => {
    const request = new Request(`${BASE}${REPORTS_PATH}`, {
      headers: { authorization: "Bearer " },
    });
    for (const unset of [undefined, ""]) {
      const response = await worker.fetch(request.clone(), { ...env, REPORTS_TOKEN: unset });
      expect(response.status).toBe(404);
    }
    // The same request with the token set is read.
    const withToken = new Request(`${BASE}${REPORTS_PATH}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect((await worker.fetch(withToken, env)).status).toBe(200);
  });
});
