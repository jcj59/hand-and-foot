import { describe, expect, it } from "vitest";
import {
  EAST_COAST,
  MAX_REPORT_BYTES,
  SPECTATOR_SEAT,
  type Card,
  type LastMove,
  type PlayerView,
  type Rank,
  type Suit,
  type ViewUpdate,
} from "@hf/shared";
import { parseReport } from "@hf/server";
import {
  attachmentRows,
  fitReport,
  jsonBytes,
  MOVE_RECORDS_KEPT,
  reportBody,
  reportContext,
  tableDetails,
  withRecord,
  type PageFacts,
  type TableReport,
} from "./context";
import { ERROR_MESSAGE_MAX, ERROR_STACK_MAX, type ClientError } from "./errors";

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
    ...overrides,
  };
}

const error = (at: number, size = 10): ClientError => ({
  at,
  message: `E${at} ${"m".repeat(size)}`.slice(0, ERROR_MESSAGE_MAX),
  where: `https://example.test/assets/index.js:${at}:1`,
  stack: "s".repeat(Math.min(size, ERROR_STACK_MAX)),
});

function page(overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    build: "abc1234",
    at: Date.UTC(2026, 10, 20, 15, 30),
    path: "/room/ABC234",
    userAgent: "Mozilla/5.0 (Test)",
    width: 390,
    height: 844,
    pixelRatio: 3,
    phone: true,
    userId: "u".repeat(20),
    username: "ana",
    errors: [],
    ...overrides,
  };
}

/** Every card id in a JSON text. */
function idsIn(json: string): string[] {
  const all = [...HAND, ...FOOT, ...MINE[0]!.cards, ...THEIRS[0]!.cards, ...PILE].map((c) => c.id);
  return all.filter((id) => json.includes(id));
}

describe("the table's details", () => {
  it("carries the room, seat, round, phase and the player's own counts", () => {
    expect(tableDetails(table())).toEqual({
      room: "ABC234",
      seat: 0,
      round: 2,
      rounds: 4,
      phase: "play",
      seatToPlay: 1,
      roundOver: false,
      paused: false,
      players: 2,
      yourCards: { hand: 3, foot: 2, inFoot: true, down: true, melds: 1, owedToPile: 1 },
      stock: 40,
      pile: 2,
      moveLines: ["ben drew a card", "ben discarded the 8♥"],
      lastMoves: [
        { seq: 1, seat: 1, kind: "draw" },
        { seq: 2, seat: 1, kind: "discard", card: PILE[1] },
      ],
    });
  });

  it("never carries a card of anyone's but those in the moves this seat was shown", () => {
    // The opponent's melds, the player's own hand, foot and melds, and the pile
    // are all in the view; only the discarded card the moves name may be sent.
    const json = JSON.stringify(reportContext(page(), table()));
    expect(idsIn(json)).toEqual([PILE[1]!.id]);
    for (const c of THEIRS[0]!.cards) expect(json).not.toContain(c.id);
    // No meld of anyone's travels at all, and no opponent's counts either.
    expect(json).not.toMatch(/opponents|"melds":\[/);
    expect(json).not.toContain("handCount");
  });

  it("copies a move field by field, so nothing else riding on it is sent", () => {
    const sneaky = { ...move(3, { kind: "meld", count: 3, marva: true }), extra: HAND } as LastMove;
    const details = tableDetails(table({ lastMoves: [sneaky] }));
    expect(details.lastMoves).toEqual([{ seq: 3, seat: 1, kind: "meld", count: 3, marva: true }]);
    expect(idsIn(JSON.stringify(details))).toEqual([]);
  });

  it("copies a move's card by its id, rank and suit only", () => {
    const card = { ...PILE[1]!, extra: HAND } as Card;
    const details = tableDetails(table({ lastMoves: [move(5, { kind: "discard", card })] }));
    expect(details.lastMoves).toEqual([{ seq: 5, seat: 1, kind: "discard", card: PILE[1] }]);
    expect(idsIn(JSON.stringify(details))).toEqual([PILE[1]!.id]);
  });

  it("leaves out the card of a draw, which is a card in the player's own hand", () => {
    const details = tableDetails(
      table({ lastMoves: [move(6, { seat: 0, kind: "draw", card: HAND[0]! })] }),
    );
    expect(details.lastMoves).toEqual([{ seq: 6, seat: 0, kind: "draw" }]);
    expect(idsIn(JSON.stringify(details))).toEqual([]);
  });

  it("keeps a move's count of 0", () => {
    expect(
      tableDetails(table({ lastMoves: [move(4, { kind: "takePile", count: 0 })] })).lastMoves,
    ).toEqual([{ seq: 4, seat: 1, kind: "takePile", count: 0 }]);
  });

  it("carries no cards of the player's own for someone watching", () => {
    const details = tableDetails(
      table({ update: update({ seat: SPECTATOR_SEAT, hand: [], foot: null }) }),
    );
    expect(details.seat).toBe("watching");
    expect(details).not.toHaveProperty("yourCards");
  });

  it("says when the round is over and the table paused", () => {
    const details = tableDetails(table({ roundOver: true, update: update({}, true) }));
    expect(details.roundOver).toBe(true);
    expect(details.paused).toBe(true);
  });

  it("carries only the last 20 moves", () => {
    const many = Array.from({ length: 25 }, (_, i) => move(i + 1));
    const details = tableDetails(table({ lastMoves: many }));
    expect(details.lastMoves.map((m) => m.seq)).toEqual(many.slice(5).map((m) => m.seq));
  });
});

describe("keeping the latest moves", () => {
  it("keeps each move once, newest last", () => {
    let list = withRecord([], move(1));
    list = withRecord(list, move(1));
    list = withRecord(list, move(2));
    expect(list.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("keeps the newest 20, dropping the oldest", () => {
    expect(MOVE_RECORDS_KEPT).toBe(20);
    let list: LastMove[] = [];
    for (let seq = 1; seq <= 21; seq++) list = withRecord(list, move(seq));
    expect(list).toHaveLength(20);
    expect(list[0]!.seq).toBe(2);
    expect(list[19]!.seq).toBe(21);
  });

  it("never changes the list it was given", () => {
    const list = [move(1)];
    withRecord(list, move(2));
    withRecord(list, move(1));
    expect(list).toEqual([move(1)]);
  });
});

describe("the whole context", () => {
  it("carries the page, the player and the errors", () => {
    const errors = [error(1)];
    expect(reportContext(page({ errors }), null)).toEqual({
      build: "abc1234",
      time: "2026-11-20T15:30:00.000Z",
      path: "/room/ABC234",
      userAgent: "Mozilla/5.0 (Test)",
      viewport: "390x844 @3x",
      layout: "phone",
      userId: "u".repeat(20),
      username: "ana",
      errors,
    });
  });

  it("leaves out who the player is when the browser has no identity, and says a computer", () => {
    const context = reportContext(page({ userId: null, username: null, phone: false }), null);
    expect(context).not.toHaveProperty("userId");
    expect(context).not.toHaveProperty("username");
    expect(context.layout).toBe("computer");
  });

  it("carries the table only when given one", () => {
    expect(reportContext(page(), table()).table?.room).toBe("ABC234");
    expect(reportContext(page(), null)).not.toHaveProperty("table");
  });
});

describe("fitting the server's size limit", () => {
  it("sends a small report whole, its text trimmed", () => {
    const context = reportContext(page({ errors: [error(1)] }), table());
    expect(fitReport("  it froze \n", context)).toEqual({ text: "it froze", context });
  });

  it("measures with the widest arrival time the server can stamp", () => {
    const context = reportContext(page({ errors: [error(1), error(2)] }), table());
    const room = MAX_REPORT_BYTES - jsonBytes({ at: 9_999_999_999_999, text: "", context });
    expect(fitReport("a".repeat(room), context).context.errors).toHaveLength(2);
    expect(fitReport("a".repeat(room + 1), context).context.errors).toHaveLength(1);
  });

  it("drops the oldest errors first, then the oldest moves, then the move lines", () => {
    const errors = Array.from({ length: 20 }, (_, i) => error(i + 1, 280));
    const lastMoves = Array.from({ length: 20 }, (_, i) =>
      move(i + 1, { kind: "discard", card: PILE[0]! }),
    );
    const context = reportContext(page({ errors }), table({ lastMoves }));
    expect(jsonBytes(context)).toBeGreaterThan(MAX_REPORT_BYTES);

    const fitted = fitReport("x".repeat(500), context).context;
    expect(fitted.errors.length).toBeGreaterThan(0);
    expect(fitted.errors.length).toBeLessThan(20);
    // The newest are the ones kept.
    expect(fitted.errors.at(-1)).toEqual(errors.at(-1));
    expect(fitted.table?.lastMoves).toHaveLength(20);

    // Longer text leaves no room for errors, then cuts into the moves, newest kept.
    // (A control character is six bytes of JSON.)
    const tight = fitReport("\u0001".repeat(1_100), context).context;
    expect(tight.errors).toEqual([]);
    expect(tight.table!.lastMoves.length).toBeLessThan(20);
    expect(tight.table!.lastMoves.at(-1)!.seq).toBe(20);
    expect(tight.table!.moveLines).toHaveLength(2);
  });

  it("drops the move lines last, the oldest first", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i} ${"y".repeat(150)}`);
    const context = reportContext(page(), table({ moveLines: lines, lastMoves: [move(1)] }));
    const fitted = fitReport("z".repeat(1500), context).context;
    expect(fitted.table!.lastMoves).toEqual([]);
    expect(fitted.table!.moveLines.length).toBeLessThan(40);
    expect(fitted.table!.moveLines.at(-1)).toBe(lines.at(-1));
  });

  it("keeps every fitted report within what the server accepts", () => {
    const errors = Array.from({ length: 20 }, (_, i) => error(i + 1, 2_000));
    const lastMoves = Array.from({ length: 20 }, (_, i) =>
      move(i + 1, { kind: "discard", card: PILE[0]! }),
    );
    const context = reportContext(
      page({ userAgent: "U".repeat(400), errors }),
      table({ lastMoves }),
    );
    for (const text of ["short", "w".repeat(2_000), "🙂".repeat(1_000), "é".repeat(2_000)]) {
      const body = reportBody(fitReport(text, context));
      const parsed = parseReport(body, 9_999_999_999_999);
      expect(parsed.ok).toBe(true);
    }
  });

  it("sends a report that cannot fit as it is, for the server to refuse", () => {
    const context = reportContext(page(), table());
    const body = fitReport("\u0001".repeat(2_000), context);
    expect(body.context.table?.moveLines).toEqual([]);
    expect(parseReport(reportBody(body), 0)).toEqual({
      ok: false,
      error: "that report has too much attached",
    });
  });
});

describe("the list of what is sent", () => {
  it("says everything at a table in words", () => {
    const context = reportContext(page({ errors: [error(1), error(2)] }), table());
    expect(attachmentRows(context)).toEqual([
      { label: "Version", value: "abc1234" },
      { label: "Time", value: "2026-11-20T15:30:00.000Z" },
      { label: "Page", value: "/room/ABC234" },
      { label: "Browser", value: "Mozilla/5.0 (Test)" },
      { label: "Screen", value: "390x844 @3x, phone layout" },
      { label: "Profile", value: `@ana, id ${"u".repeat(20)}` },
      { label: "Table", value: "ABC234, seat 0, round 2 of 4, play phase" },
      { label: "Your cards", value: "how many only: 3 cards in hand, 2 in the foot, 1 meld" },
      { label: "Piles", value: "stock 40, pile 2" },
      { label: "Moves", value: "the last 2 moves, as you were shown them" },
      { label: "Errors", value: "the last 2 errors on this page" },
    ]);
  });

  it("says when a round is over, a table paused, or the player is watching", () => {
    const over = reportContext(page(), table({ roundOver: true, update: update({}, true) }));
    expect(attachmentRows(over).find((r) => r.label === "Table")?.value).toBe(
      "ABC234, seat 0, round 2 of 4, round over, paused",
    );
    const watching = reportContext(
      page(),
      table({ update: update({ seat: SPECTATOR_SEAT }), lastMoves: [move(1)] }),
    );
    const rows = attachmentRows(watching);
    expect(rows.find((r) => r.label === "Table")?.value).toBe(
      "ABC234, watching, round 2 of 4, play phase",
    );
    expect(rows.find((r) => r.label === "Your cards")).toBeUndefined();
    expect(rows.find((r) => r.label === "Moves")?.value).toBe(
      "the last 1 move, as you were shown them",
    );
  });

  it("says one card and many melds rightly", () => {
    const context = reportContext(
      page(),
      table({ update: update({ hand: [HAND[0]!], melds: [...MINE, ...MINE] }) }),
    );
    expect(attachmentRows(context).find((r) => r.label === "Your cards")?.value).toBe(
      "how many only: 1 card in hand, 2 in the foot, 2 melds",
    );
  });

  it("says away from a table only the page, the profile and the errors", () => {
    const rows = attachmentRows(reportContext(page({ username: null, errors: [error(1)] }), null));
    expect(rows.map((r) => r.label)).toEqual([
      "Version",
      "Time",
      "Page",
      "Browser",
      "Screen",
      "Profile",
      "Errors",
    ]);
    expect(rows.find((r) => r.label === "Profile")?.value).toBe(`id ${"u".repeat(20)}`);
    expect(rows.at(-1)?.value).toBe("the last 1 error on this page");
  });

  it("names a signed-in player with no identity id, and none at all when there is neither", () => {
    expect(
      attachmentRows(reportContext(page({ userId: null }), null)).find((r) => r.label === "Profile")
        ?.value,
    ).toBe("@ana");
    const rows = attachmentRows(reportContext(page({ userId: null, username: null }), null));
    expect(rows.find((r) => r.label === "Profile")).toBeUndefined();
    expect(rows.at(-1)?.value).toBe("none on this page");
  });
});
