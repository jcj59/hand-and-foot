import { describe, expect, it } from "vitest";
import {
  EAST_COAST,
  jsonBytes,
  MAX_REPORT_BODY_BYTES,
  REMOVED,
  SPECTATOR_SEAT,
  TRUNCATED,
  type Card,
  type LastMove,
  type PlayerView,
  type Rank,
  type Suit,
  type ViewUpdate,
} from "@hf/shared";
import { parseReport } from "@hf/server";
import {
  MOVE_RECORDS_KEPT,
  reportBody,
  reportContext,
  tableDetails,
  withRecord,
  type PageFacts,
  type TableReport,
} from "./context";
import { ERROR_MESSAGE_MAX, ERROR_STACK_MAX, type ClientError } from "./errors";

/** Secrets as this browser holds them: a seat token, an identity secret, a saved game's token. */
const SEAT_TOKEN = "Qx7bLm2Np9Rt4Vw8Yz1Cd5Fg";
const IDENTITY_SECRET = "s3Kr1tAbCdEfGhIjKlMnOpQrStUvWxYz0123456789_";
const SAVED_TOKEN = "Sv2Hk8Jm4Pq6Rs0Tu3Wx5Za";
const USER_ID = "ana-identity-0000000001";

const card = (rank: Rank, suit: Suit | null, deck = 0): Card => ({
  id: `${rank}-${suit}-${deck}`,
  rank,
  suit,
});

/** The player's own cards, an opponent's melds and the pile: every card in the view. */
const HAND = [card("A", "spades"), card("4", "hearts"), card("JOKER", null)];
const FOOT = [card("K", "diamonds"), card("7", "clubs")];
const MINE = [
  { rank: "Q" as Rank, cards: [card("Q", "hearts"), card("Q", "clubs"), card("2", "spades")] },
];
const THEIRS = [
  {
    rank: "9" as Rank,
    cards: [card("9", "hearts", 1), card("9", "spades", 1), card("9", "clubs", 1)],
  },
];
const PILE = [card("5", "diamonds"), card("8", "hearts")];

function view(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    seat: 0,
    hand: HAND,
    foot: FOOT,
    footCount: 2,
    melds: MINE,
    isDown: true,
    inFoot: true,
    opponents: [
      { seat: 1, handCount: 9, footCount: 11, melds: THEIRS, isDown: true, inFoot: false },
    ],
    discard: PILE,
    stockCount: 40,
    currentSeat: 1,
    phase: "play",
    roundNumber: 2,
    pickedUp: [HAND[0]!.id],
    playedThisTurn: [],
    wentOutSeat: null,
    finalLapRemaining: null,
    scoresSoFar: [120, 80],
    departed: [],
    ...overrides,
  };
}

function update(overrides: Partial<PlayerView> = {}, paused = false): ViewUpdate {
  return {
    view: view(overrides),
    clock: { serverNow: 1_000, deadlineAt: null, inDiscardGrace: false, paused },
    room: {
      roomId: "ABC234",
      players: [
        { seat: 0, name: "ana", connected: true },
        { seat: 1, name: "ben", connected: true },
      ],
      hostSeat: 0,
      started: true,
      config: EAST_COAST,
      playAgain: [],
      nextRoundReady: [],
    },
    hints: {
      seatToAct: 1,
      phase: "play",
      canDraw: false,
      canTakePile: false,
      meldableRanks: [],
      canGoOut: false,
    },
  };
}

const move = (seq: number, extra: Partial<LastMove> = {}): LastMove => ({
  seq,
  seat: 1,
  kind: "draw",
  ...extra,
});

function table(overrides: Partial<TableReport> = {}): TableReport {
  return {
    update: update(),
    moveLines: ["ben drew a card", "ben discarded the 8♥"],
    lastMoves: [move(1), move(2, { kind: "discard", card: PILE[1]! })],
    roundOver: false,
    screen: { staging: { groups: [], focusedRank: null }, chosenId: null, busy: false },
    ...overrides,
  };
}

const error = (at: number, size = 10): ClientError => ({
  at,
  message: `E${at} ${"m".repeat(size)}`.slice(0, ERROR_MESSAGE_MAX),
  where: `https://example.test/assets/index.js:${at}:1`,
  stack: "s".repeat(Math.min(size, ERROR_STACK_MAX)),
});

/** A page as this browser would read it at a table, secrets and all. */
function page(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    build: "abc1234",
    at: Date.UTC(2026, 10, 20, 15, 30),
    serverOffsetMs: 120,
    route: { path: "/room/ABC234", search: "", hash: "", state: { idx: 2, key: "k1" } },
    device: { reducedMotion: false, colorScheme: "dark", language: "en-US", online: true },
    width: 390,
    height: 844,
    pixelRatio: 3,
    phone: true,
    userAgent: "Mozilla/5.0 (Test)",
    userId: USER_ID,
    username: "ana",
    name: "Ana",
    avatar: null,
    errors: [],
    frames: [
      {
        at: 1,
        direction: "sent",
        frame: {
          id: 1,
          event: "resumeSeat",
          payload: { roomId: "ABC234", seat: 0, token: REMOVED },
        },
      },
      { at: 2, direction: "received", frame: { ack: 1, result: { ok: true, data: { seat: 0 } } } },
    ],
    console: [
      { at: 3, level: "log", message: `reclaiming seat with ${SEAT_TOKEN}` },
      { at: 4, level: "warn", message: "slow frame" },
    ],
    notices: [{ at: 5, text: "it is not your turn" }],
    session: {
      status: "connected",
      credentials: { roomId: "ABC234", seat: 0, token: SEAT_TOKEN },
      notice: null,
    },
    storage: {
      local: {
        "hf.identity": { userId: USER_ID, secret: IDENTITY_SECRET },
        "hf.seat": { roomId: "ABC234", seat: 0, token: SEAT_TOKEN },
        "hf.savedGames": [{ roomId: "XYZ789", seat: 1, token: SAVED_TOKEN, names: ["ana"] }],
        "hf.muted": true,
        "hf.account": "ana",
      },
      session: { "hf.seat": { roomId: "ABC234", seat: 0, token: SEAT_TOKEN } },
    },
    secrets: [IDENTITY_SECRET, SEAT_TOKEN, SAVED_TOKEN],
    ...overrides,
  };
}

/** The body the sheet would send, as JSON. */
function sent(p = page(), t: TableReport | null = table(), text = "it froze"): string {
  return JSON.stringify(reportBody(text, reportContext(p, t), p.secrets));
}

describe("what a report carries at a table", () => {
  it("the whole update, the room, the player's own cards with their ids, the hints and the screen", () => {
    const details = tableDetails(table());
    const u = update();
    expect(details).toEqual({
      room: u.room,
      update: u,
      own: {
        hand: HAND,
        footCount: 2,
        inFoot: true,
        isDown: true,
        melds: MINE,
        pickedUp: [HAND[0]!.id],
      },
      hints: u.hints,
      screen: table().screen,
      roundOver: false,
      moveLines: ["ben drew a card", "ben discarded the 8♥"],
      lastMoves: table().lastMoves,
    });
  });

  it("every card in the view, other players' melds included, by id", () => {
    const json = sent();
    for (const c of [...HAND, ...FOOT, ...MINE[0]!.cards, ...THEIRS[0]!.cards, ...PILE]) {
      expect(json).toContain(c.id);
    }
  });

  it("the card of a draw, which the server sent this seat", () => {
    const drew = move(6, { seat: 0, kind: "draw", card: HAND[0]! });
    const details = tableDetails(table({ lastMoves: [drew] }));
    expect(details.lastMoves).toEqual([drew]);
  });

  it("no cards of the player's own for someone watching", () => {
    const details = tableDetails(
      table({ update: update({ seat: SPECTATOR_SEAT, hand: [], foot: null }) }),
    );
    expect(details).not.toHaveProperty("own");
    expect(
      reportContext(page(), table({ update: update({ seat: SPECTATOR_SEAT }) })).summary.seat,
    ).toBe("watching");
  });
});

describe("keeping the latest moves", () => {
  it("keeps each move once, newest last", () => {
    let list = withRecord([], move(1));
    list = withRecord(list, move(1));
    list = withRecord(list, move(2));
    expect(list.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("keeps the newest 200, dropping the oldest", () => {
    expect(MOVE_RECORDS_KEPT).toBe(200);
    let list: LastMove[] = [];
    for (let seq = 1; seq <= 201; seq++) list = withRecord(list, move(seq));
    expect(list).toHaveLength(200);
    expect(list[0]!.seq).toBe(2);
    expect(list[199]!.seq).toBe(201);
  });

  it("never changes the list it was given", () => {
    const list = [move(1)];
    withRecord(list, move(2));
    withRecord(list, move(1));
    expect(list).toEqual([move(1)]);
  });
});

describe("the whole context", () => {
  it("starts with a summary a developer reads first", () => {
    expect(reportContext(page(), table()).summary).toEqual({
      build: "abc1234",
      time: "2026-11-20T15:30:00.000Z",
      path: "/room/ABC234",
      layout: "phone",
      viewport: "390x844 @3x",
      browser: "Mozilla/5.0 (Test)",
      user: `@ana ${USER_ID}`,
      room: "ABC234",
      seat: 0,
      round: "2 of 4",
      phase: "play",
      seatToPlay: 1,
    });
    const over = reportContext(
      page({ phone: false, userId: null, username: null }),
      table({ roundOver: true }),
    );
    expect(over.summary).toMatchObject({ layout: "computer", phase: "round over" });
    expect(over.summary).not.toHaveProperty("user");
    expect(reportContext(page(), null).summary).not.toHaveProperty("room");
  });

  it("carries the page, the device, the profile, the logs, the session and the storage", () => {
    const p = page({ errors: [error(1)] });
    const context = reportContext(p, table());
    expect(context.page).toEqual({
      build: "abc1234",
      at: p.at,
      serverOffsetMs: 120,
      route: p.route,
      viewport: { width: 390, height: 844, pixelRatio: 3 },
      layout: "phone",
      userAgent: "Mozilla/5.0 (Test)",
      reducedMotion: false,
      colorScheme: "dark",
      language: "en-US",
      online: true,
    });
    expect(context.user).toEqual({ userId: USER_ID, username: "ana", name: "Ana", avatar: null });
    expect(context.logs).toEqual({
      frames: p.frames,
      console: p.console,
      errors: [error(1)],
      notices: p.notices,
    });
    expect(context.storage).toBe(p.storage);
    // At a table the session's update is the table's, carried once.
    expect(context.session.update).toBe("the same as table.update");
    expect(reportContext(p, null).session).toBe(p.session);
    expect(reportContext(p, null)).not.toHaveProperty("table");
  });
});

describe("what a report never carries", () => {
  it("a seat token, an identity secret or a saved game's token, anywhere", () => {
    const json = sent();
    for (const secret of [SEAT_TOKEN, IDENTITY_SECRET, SAVED_TOKEN])
      expect(json).not.toContain(secret);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading JSON back to check it
    const body = JSON.parse(json) as { context: Record<string, any> };
    expect(body.context.storage.local["hf.identity"]).toEqual({ userId: USER_ID, secret: REMOVED });
    expect(body.context.storage.local["hf.seat"].token).toBe(REMOVED);
    expect(body.context.storage.session["hf.seat"].token).toBe(REMOVED);
    expect(body.context.storage.local["hf.savedGames"][0]).toMatchObject({
      roomId: "XYZ789",
      token: REMOVED,
    });
    expect(body.context.session.credentials).toEqual({ roomId: "ABC234", seat: 0, token: REMOVED });
    // A token quoted in a console line is cut out of it too.
    expect(body.context.logs.console[0].message).toBe(`reclaiming seat with ${REMOVED}`);
    // What is not a secret stays.
    expect(body.context.storage.local["hf.muted"]).toBe(true);
    expect(body.context.user.userId).toBe(USER_ID);
  });

  it("a secret the page knows even where no key names it", () => {
    const p = page({
      storage: { local: {}, session: {} },
      session: {},
      console: [{ at: 1, level: "error", message: `failed ${IDENTITY_SECRET}` }],
    });
    expect(sent(p)).not.toContain(IDENTITY_SECRET);
    expect(sent({ ...p, secrets: [] })).toContain(IDENTITY_SECRET);
  });

  it("a password or an auth header in a frame", () => {
    const p = page({
      frames: [
        {
          at: 1,
          direction: "sent",
          frame: { payload: { password: "hunter2hunter2", currentPassword: "x" } },
        },
        { at: 2, direction: "sent", frame: { headers: { Authorization: "Bearer 1234567890" } } },
      ],
    });
    const json = sent(p);
    expect(json).not.toContain("hunter2hunter2");
    expect(json).not.toContain("Bearer 1234567890");
  });
});

describe("the body sent", () => {
  it("names the table, trims the text, and sends a small report whole", () => {
    const body = reportBody("  it froze \n", reportContext(page(), table()), page().secrets);
    expect(body.text).toBe("it froze");
    expect(body.room).toBe("ABC234");
    expect(body.context).not.toHaveProperty("truncated");
    expect(reportBody("x", reportContext(page(), null))).not.toHaveProperty("room");
  });

  it("fits 256 KB by cutting the largest logs first, newest kept, and says what it cut", () => {
    const frames = Array.from({ length: 200 }, (_, i) => ({
      at: i,
      direction: "received" as const,
      frame: { event: "view", payload: update(), pad: "p".repeat(2_000) },
    }));
    const context = reportContext(page({ frames }), table());
    expect(jsonBytes(context)).toBeGreaterThan(MAX_REPORT_BODY_BYTES);
    const body = reportBody("it froze", context, page().secrets);
    const fitted = body.context as unknown as {
      logs: { frames: typeof frames; console: unknown[] };
      table: { update: unknown };
      truncated: { section: string; kept?: number; of?: number }[];
    };
    expect(fitted.logs.frames.length).toBeLessThan(200);
    expect(fitted.logs.frames.at(-1)!.at).toBe(199);
    expect(fitted.logs.console).toHaveLength(2);
    expect(fitted.table.update).toEqual(update());
    expect(fitted.truncated).toEqual([
      {
        section: "logs.frames",
        bytes: expect.any(Number),
        kept: fitted.logs.frames.length,
        of: 200,
      },
    ]);
    expect(parseReport(body, 9_999_999_999_999).ok).toBe(true);
  });

  it("keeps every fitted report within what the server accepts", () => {
    const errors = Array.from({ length: 20 }, (_, i) => error(i + 1, 2_000));
    const frames = Array.from({ length: 200 }, (_, i) => ({
      at: i,
      direction: "sent" as const,
      frame: { pad: "€".repeat(3_000) },
    }));
    const history = {
      matches: Array.from({ length: 300 }, (_, i) => ({ i, pad: "h".repeat(500) })),
    };
    const p = page({
      userAgent: "U".repeat(400),
      errors,
      frames,
      storage: { local: { "hf.history:x": history }, session: { "hf.history:x": history } },
    });
    for (const text of ["short", "w".repeat(2_000), "🙂".repeat(1_000), "é".repeat(2_000)]) {
      const body = reportBody(text, reportContext(p, table()), p.secrets);
      expect(parseReport(body, 9_999_999_999_999).ok).toBe(true);
    }
  });

  it("measures the text too, to the byte, and cuts inside the browser's storage", () => {
    const history = Array.from({ length: 6_000 }, (_, i) => ({ i, pad: "h".repeat(40) }));
    const p = page({
      storage: { local: { "hf.history:x": history, "hf.muted": true }, session: {} },
    });
    // A control character is six bytes of JSON: 12 KB of text the fitting must leave room for.
    const body = reportBody("\u0001".repeat(2_000), reportContext(p, table()), p.secrets);
    expect(parseReport(body, 9_999_999_999_999).ok).toBe(true);
    const local = (body.context as unknown as { storage: { local: Record<string, unknown> } })
      .storage.local;
    expect(local["hf.muted"]).toBe(true);
    expect((local["hf.history:x"] as unknown[]).length).toBeLessThan(6_000);
  });

  it("keeps the table's update while cutting the logs is enough, even when it is the largest", () => {
    const big = update({
      discard: Array.from({ length: 4_000 }, (_, i) => card("5", "hearts", i)),
    });
    const frames = Array.from({ length: 3_000 }, (_, i) => ({
      at: i,
      direction: "received" as const,
      frame: { pad: "f".repeat(80) },
    }));
    const p = page({ frames });
    const body = reportBody("x", reportContext(p, table({ update: big })), p.secrets);
    const fitted = body.context as unknown as {
      table: { update: unknown };
      logs: { frames: unknown[] };
    };
    expect(fitted.table.update).toEqual(big);
    expect(fitted.logs.frames.length).toBeLessThan(3_000);
    expect(parseReport(body, 9_999_999_999_999).ok).toBe(true);
  });

  it("cuts the table's update only after everything else", () => {
    const huge = update({
      discard: Array.from({ length: 8_000 }, (_, i) => card("5", "hearts", i)),
    });
    const body = reportBody("x", reportContext(page(), table({ update: huge })), page().secrets);
    const fitted = body.context as unknown as {
      table: { update: unknown; room: unknown };
      summary: unknown;
      truncated: { section: string }[];
    };
    expect(fitted.table.update).toBe(TRUNCATED);
    expect(fitted.truncated.at(-1)!.section).toBe("table.update");
    expect(fitted.summary).toEqual(reportContext(page(), table({ update: huge })).summary);
    expect(parseReport(body, 9_999_999_999_999).ok).toBe(true);
  });
});
