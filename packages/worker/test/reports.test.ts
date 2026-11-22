/**
 * Bug reports on the Worker: sent over HTTP as the client sends them, kept in the
 * one reports object, capped, rate limited before the object is asked, and read
 * back only with the token. Worker test storage outlives a test, so each test
 * finds its own reports by their text or address rather than counting them all.
 */
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { NO_TABLE, type ReportDraft, type Room, type TableChannel } from "@hf/server/core";
import {
  REMOVED,
  REPORTS_PATH,
  ROOMS_PATH,
  type Ack,
  type BugReport,
  type ReportsPage,
  type SeatCredentials,
} from "@hf/shared";
import worker from "../src/index";
import { REPORT_LIMIT, REPORT_WINDOW_MS, reportKey } from "../src/limits";
import { REPORTS_OBJECT, type ReportsObject } from "../src/reports";
import type { TableObject } from "../src/table";

const BASE = "http://game.example";
const TOKEN = "test-reports-token";

function send(body: unknown, address = "203.0.113.1"): Promise<Response> {
  return SELF.fetch(`${BASE}${REPORTS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": address },
    body: JSON.stringify(body),
  });
}

async function read(since = 0, token: string | null = TOKEN, after = -1): Promise<Response> {
  return SELF.fetch(`${BASE}${REPORTS_PATH}?since=${since}&after=${after}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

async function page(since = 0, after = -1): Promise<ReportsPage> {
  const answer = (await (await read(since, TOKEN, after)).json()) as Ack<ReportsPage>;
  if (!answer.ok) throw new Error(answer.error);
  return answer.data;
}

/** Every kept report, read page by page as the pull script does. */
async function kept(): Promise<BugReport[]> {
  const all: BugReport[] = [];
  for (let after = -1; ;) {
    const { reports, more } = await page(0, after);
    all.push(...reports);
    if (!more) return all;
    after = reports.at(-1)!.id;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const answer = (await response.json()) as Ack<T>;
  if (!answer.ok) throw new Error(answer.error);
  return answer.data;
}

/** A dealt two-seat table with a move played and a line of chat; both seats' credentials. */
async function dealtTable(): Promise<{ ana: SeatCredentials; ben: SeatCredentials }> {
  const ana = await post<SeatCredentials>(ROOMS_PATH, { name: "ana" });
  const ben = await post<SeatCredentials>(`${ROOMS_PATH}/${ana.roomId}/join`, { name: "ben" });
  await runInDurableObject(env.TABLES.getByName(ana.roomId), (instance: TableObject) => {
    const room = (instance as unknown as { channel: TableChannel }).channel.room as Room;
    room.start(room.hostSeat);
    const seat = room.gameState!.currentSeat;
    room.submitAction(seat, { type: "draw" });
    room.chat(0, "good luck");
  });
  return { ana, ben };
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
    const later = await page(mine!.at);
    expect(later.reports.some((r) => r.id === mine!.id)).toBe(false);
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

  it("keeps the newest 200, dropping the oldest first, read 16 at a time", async () => {
    const stub = env.REPORTS.getByName(REPORTS_OBJECT);
    const ids = await runInDurableObject(stub, async (object: ReportsObject) => {
      const added: (number | null)[] = [];
      for (let i = 0; i < 205; i++) {
        added.push(await object.add({ at: 1, text: `cap ${i}`, context: {}, room: null }));
      }
      return added;
    });
    const all = await kept();
    expect(all.length).toBe(200);
    expect(all.map((r) => r.id)).toEqual(ids.slice(5));
    expect(all.some((r) => r.text === "cap 4")).toBe(false);
    expect(all[0]!.text).toBe("cap 5");
    const first = await page();
    expect(first.reports.length).toBe(16);
    expect(first.more).toBe(true);
    const last = await page(0, ids.at(-2)!);
    expect(last).toEqual({ reports: [all.at(-1)], more: false });
  });

  it("attaches the named table's whole record, with no seat token anywhere", async () => {
    const { ana, ben } = await dealtTable();
    const response = await send(
      {
        text: "my cards moved",
        room: ana.roomId.toLowerCase(),
        context: {
          summary: { room: ana.roomId },
          storage: { "hf.seat": { roomId: ana.roomId, seat: 0, token: ana.token } },
          console: [`resumed with ${ana.token}`],
          // Named under no key at all: only the table's own tokens find it.
          quoted: `ben sits with ${ben.token}`,
        },
      },
      "203.0.113.40",
    );
    const answer = (await response.json()) as Ack<{ id: number }>;
    expect(answer.ok).toBe(true);
    const mine = (await kept()).find((r) => r.id === (answer.ok ? answer.data.id : -1))!;
    expect(mine.table?.attached).toBe(true);
    const record = mine.table?.attached ? mine.table.record : null;
    expect(record).toMatchObject({
      code: ana.roomId,
      started: true,
      players: [
        { seat: 0, name: "ana" },
        { seat: 1, name: "ben" },
      ],
      chat: [{ seat: 0, text: "good luck" }],
    });
    expect(record!.actions).toMatchObject([{ seq: 0, action: { type: "draw" } }]);
    expect(record!.state!.players).toHaveLength(2);
    expect(typeof record!.seed).toBe("number");
    expect(mine.context).toMatchObject({
      storage: { "hf.seat": { token: REMOVED } },
      console: [`resumed with ${REMOVED}`],
      quoted: `ben sits with ${REMOVED}`,
    });
    const json = JSON.stringify(mine);
    expect(json).not.toContain(ana.token);
    expect(json).not.toContain(ben.token);
  });

  it("keeps a report whose table is gone, saying so", async () => {
    const response = await send({ text: "the table vanished", room: "ZZZ999" }, "203.0.113.41");
    expect(((await response.json()) as Ack).ok).toBe(true);
    const mine = (await kept()).find((r) => r.text === "the table vanished")!;
    expect(mine.table).toEqual({ code: "ZZZ999", attached: false, reason: NO_TABLE });
    // A code that is not one is not asked about at all.
    await send({ text: "not a code", room: "../x" }, "203.0.113.41");
    expect((await kept()).find((r) => r.text === "not a code")).not.toHaveProperty("table");
  });

  it("keeps a report whose table does not answer, saying why", async () => {
    const stub = env.REPORTS.getByName(REPORTS_OBJECT);
    const id = await runInDurableObject(stub, async (object: ReportsObject) => {
      const inside = object as unknown as { env: typeof env };
      const real = inside.env;
      inside.env = {
        ...real,
        TABLES: {
          getByName: () => ({ reportRecord: () => Promise.reject(new Error("object reset")) }),
        } as unknown as typeof env.TABLES,
      };
      try {
        return await object.add({ at: 2, text: "unreachable", context: {}, room: "ABC234" });
      } finally {
        inside.env = real;
      }
    });
    const mine = (await kept()).find((r) => r.id === id)!;
    expect(mine.table).toEqual({
      code: "ABC234",
      attached: false,
      reason: "the table did not answer: object reset",
    });
  });

  it("keeps nothing, and says so, for a report that cannot be made to fit", async () => {
    const stub = env.REPORTS.getByName(REPORTS_OBJECT);
    const draft: ReportDraft = { at: 3, text: "x".repeat(600_000), context: {}, room: null };
    const before = await runInDurableObject(stub, (_, state) => state.storage.kv.get("next"));
    expect(await runInDurableObject(stub, (object: ReportsObject) => object.add(draft))).toBeNull();
    expect(await runInDurableObject(stub, (_, state) => state.storage.kv.get("next"))).toBe(before);
  });

  it("reads a report of up to twice the cap before refusing it for its size", async () => {
    const pad = (n: number) => ({ text: "big", context: { pad: "a".repeat(n) } });
    const over = await send(pad(300_000), "203.0.113.50");
    expect(over.status).toBe(200);
    expect(await over.json()).toEqual({ ok: false, error: "that report has too much attached" });
    expect((await send(pad(600_000), "203.0.113.50")).status).toBe(400);
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
