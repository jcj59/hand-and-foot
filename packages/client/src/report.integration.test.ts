// @vitest-environment node
/**
 * A bug report against a real server, through the client's own transport and
 * HTTP: two players at a dealt table, the reporting player's socket frames
 * recorded as the page records them, the report built from what that seat was
 * sent and posted the way the sheet posts it. The server attaches the table's
 * whole record, and no seat token, identity secret or the like is in what it
 * keeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, InMemoryReportStore, type HandAndFootServer } from "@hf/server";
import { defaultAction, replay } from "@hf/engine";
import type { ViewUpdate } from "@hf/shared";
import { reportReplay } from "@hf/server";
import { sendReport } from "./actions";
import { httpPost, type Post } from "./identity";
import { reportBody, reportContext, type PageFacts } from "./report/context";
import { forgetRecords, noteFrame, recentRecords } from "./report/recorder";
import { connect, createRoom, joinRoom, startGame, type HfClientSocket } from "./socket";

let server: HandAndFootServer;
let reports: InMemoryReportStore;
let url: string;
let post: Post;
const sockets: HfClientSocket[] = [];

const USER = { userId: "ana-identity-00000001", secret: "AnaSecret".repeat(5) };

beforeEach(async () => {
  // The Node host logs each report it keeps; the test checks what it kept instead.
  vi.spyOn(console, "log").mockImplementation(() => {});
  forgetRecords();
  reports = new InMemoryReportStore();
  server = createServer({ reports });
  url = `http://localhost:${await server.listen(0)}`;
  post = httpPost(url);
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  vi.restoreAllMocks();
  await server.close();
});

async function open(record = false): Promise<HfClientSocket> {
  const socket = connect(url, record ? { onFrame: (d, f) => noteFrame(d, f) } : {});
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

function page(secrets: readonly string[]): PageFacts {
  const records = recentRecords();
  return {
    build: "abc1234",
    at: Date.now(),
    serverOffsetMs: 0,
    route: { path: "/room/X", search: "", hash: "", state: null },
    device: {},
    width: 1280,
    height: 800,
    pixelRatio: 1,
    phone: false,
    userAgent: "Mozilla/5.0 (Test)",
    userId: USER.userId,
    username: null,
    name: "ana",
    avatar: null,
    errors: [],
    frames: records.frames,
    console: [],
    notices: [],
    session: {},
    storage: { local: { "hf.identity": USER }, session: {} },
    secrets: [...secrets, ...records.secrets],
  };
}

describe("sending a bug report from a table", () => {
  it("is kept with the table's whole record, and with no secret anywhere", async () => {
    const ana = await open(true);
    const ben = await open();
    const views: ViewUpdate[] = [];
    ana.on("view", (update) => views.push(update));
    const created = await createRoom(ana, "ana", undefined, USER);
    if (!created.ok) throw new Error(created.error);
    const joined = await joinRoom(ben, created.data.roomId, "ben");
    if (!joined.ok) throw new Error(joined.error);
    await startGame(ana);
    const room = server.manager.get(created.data.roomId)!;
    for (let i = 0; i < 12; i++) {
      const state = room.gameState!;
      room.submitAction(state.currentSeat, defaultAction(state)!);
      room.onChange?.();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const update = views.at(-1)!;
    const context = reportContext(page([USER.secret, created.data.token]), {
      update,
      moveLines: [],
      lastMoves: [],
      roundOver: false,
      screen: {},
    });
    // The frames recorded the sit-down (with the identity) and every view.
    expect(context.logs.frames.length).toBeGreaterThan(5);
    const answer = await sendReport(
      post,
      reportBody("The pile looked wrong", context, page([]).secrets),
    );
    expect(answer).toEqual({ ok: true, data: { id: 0 } });

    const [kept] = await reports.since(0);
    const json = JSON.stringify(kept);
    for (const secret of [USER.secret, created.data.token, joined.data.token]) {
      expect(json).not.toContain(secret);
    }
    expect(kept!.table?.attached).toBe(true);
    const record = kept!.table?.attached ? kept!.table.record : null;
    expect(record!.code).toBe(created.data.roomId);
    expect(record!.actions).toHaveLength(12);
    expect(record!.state).toEqual(room.gameState);
    // Every card of every hand is in the kept report, so the game can be seen whole.
    for (const player of room.gameState!.players) {
      for (const card of [...player.hand, ...player.foot]) expect(json).toContain(card.id);
    }
    // And it replays to the very state the table had.
    const log = reportReplay(kept!)!;
    const setup = log.setup as { seed: number; playerCount: number; firstSeat: number };
    expect(replay(setup.seed, setup.playerCount, log.config, log.actions, setup.firstSeat)).toEqual(
      room.gameState,
    );
  });

  it("is kept from away from a table, and brings back the server's refusal", async () => {
    const context = reportContext(page([]), null);
    expect(await sendReport(post, reportBody("It froze", context))).toEqual({
      ok: true,
      data: { id: 0 },
    });
    expect((await reports.since(0))[0]).not.toHaveProperty("table");
    expect(await sendReport(post, reportBody("   ", context))).toEqual({
      ok: false,
      error: "say what went wrong",
    });
  });
});
