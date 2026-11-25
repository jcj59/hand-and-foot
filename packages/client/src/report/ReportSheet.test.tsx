/**
 * Reporting a bug, as a player does it: from Profile, and from the table's menu
 * at a live table, through to what is posted and what the sheet says back. The
 * browser holds real secrets here (an identity, a seat, a saved game), read by
 * the sheet from storage and the store as it would be in a browser, and none of
 * them may be in what is posted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  EAST_COAST,
  REPORTS_PATH,
  type Ack,
  type Card,
  type LastMove,
  type PlayerView,
  type Rank,
  type ReportBody,
  type Suit,
  type ViewUpdate,
} from "@hf/shared";
import { REPORT_NOT_SENT } from "../actions";
import { CREDENTIALS_KEY } from "../credentials";
import { ACCOUNT_KEY, IDENTITY_KEY, type Post } from "../identity";
import { SAVED_GAMES_KEY } from "../savedGames";
import { ProfilePage } from "../pages/ProfilePage";
import { Table } from "../routes/Table";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { PHONE_QUERY } from "../usePhone";
import { forgetErrors, noteError } from "./errors";
import { forgetRecords, noteConsole, noteFrame, noteNotice } from "./recorder";
import { ReportButton } from "./ReportButton";
import { PAGE_DISCLOSURE, TABLE_DISCLOSURE } from "./ReportSheet";

const SECRET = "Sk3y".repeat(10);
const SEAT_TOKEN = "Tq9mZ2xP7wL4vK8nB3cR";
const SAVED_TOKEN = "Wv5hJ1sD6fG0aY2uE9iO";

/** Every secret the page holds, none of which may leave it. */
function expectNoSecrets(body: unknown): void {
  const json = JSON.stringify(body);
  for (const secret of [SECRET, SEAT_TOKEN, SAVED_TOKEN]) expect(json).not.toContain(secret);
}

/** A server that records each report and answers with the next queued answer. */
function fakeServer(answers: (Ack<unknown> | Error)[] = []): Post & { reports: ReportBody[] } {
  const reports: ReportBody[] = [];
  const queue = [...answers];
  const post = (async (path: string, body: unknown) => {
    if (path !== REPORTS_PATH) return { ok: false, error: "not asked here" };
    reports.push(body as ReportBody);
    const answer = queue.shift() ?? { ok: true, data: { id: reports.length - 1 } };
    if (answer instanceof Error) throw answer;
    return answer;
  }) as Post & { reports: ReportBody[] };
  post.reports = reports;
  return post;
}

function phone(): void {
  window.matchMedia = ((query: string) => ({
    matches: query === PHONE_QUERY,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  forgetErrors();
  forgetRecords();
  window.localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({ userId: "u".repeat(20), secret: SECRET }),
  );
  window.localStorage.setItem(ACCOUNT_KEY, "ana");
  window.localStorage.setItem("hf.muted", "true");
  window.localStorage.setItem(
    SAVED_GAMES_KEY,
    JSON.stringify([
      {
        roomId: "XYZ789",
        seat: 1,
        token: SAVED_TOKEN,
        savedUntil: Date.now() + 1e6,
        names: ["ana"],
        round: 1,
      },
    ]),
  );
  window.localStorage.setItem("not.ours", "kept out");
  // What the page has been doing: a seat claimed over the socket, a console line
  // that quoted the token, a refusal shown.
  noteFrame("sent", {
    id: 1,
    event: "resumeSeat",
    payload: { roomId: "ABC234", seat: 0, token: SEAT_TOKEN },
  });
  noteFrame("received", { ack: 1, result: { ok: true, data: { seat: 0 } } });
  noteConsole("log", ["claimed", SEAT_TOKEN]);
  noteConsole("warn", ["slow"]);
  noteNotice("it is not your turn");
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.unstubAllGlobals();
});

function profile(post: Post): void {
  render(
    <MemoryRouter>
      <ProfilePage post={post} />
    </MemoryRouter>,
  );
}

function sheet(): HTMLElement {
  return screen.getByRole("dialog", { name: "Report a bug" });
}

function write(text: string): void {
  fireEvent.change(within(sheet()).getByRole("textbox", { name: /what went wrong/i }), {
    target: { value: text },
  });
}

function send(): void {
  fireEvent.click(within(sheet()).getByRole("button", { name: "Send report" }));
}

describe("from Profile", () => {
  it("sends what the player wrote with the page's details, and thanks them", async () => {
    noteError({ at: 1, message: "TypeError: x is undefined" });
    const server = fakeServer([{ ok: true, data: { id: 12 } }]);
    profile(server);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));

    // The hint, and one line saying what goes; no list, no checkbox, no JSON.
    expect(within(sheet()).getByText(/what you were doing/i)).toBeInTheDocument();
    expect(within(sheet()).getByText(PAGE_DISCLOSURE)).toBeInTheDocument();
    expect(within(sheet()).queryByRole("region")).toBeNull();
    expect(within(sheet()).queryByRole("checkbox")).toBeNull();
    expect(within(sheet()).queryByText(/exactly what is sent/i)).toBeNull();

    // Nothing to send until something is written.
    expect(within(sheet()).getByRole("button", { name: "Send report" })).toBeDisabled();
    write("   ");
    expect(within(sheet()).getByRole("button", { name: "Send report" })).toBeDisabled();
    write("  The scores did not add up  ");
    send();

    await waitFor(() => expect(within(sheet()).getByRole("status")).toHaveTextContent(/thanks/i));
    expect(within(sheet()).getByRole("status")).toHaveTextContent("It is report 12.");
    expect(server.reports).toHaveLength(1);
    const [report] = server.reports;
    expect(report!.text).toBe("The scores did not add up");
    expect(report!.context).toMatchObject({
      summary: {
        build: expect.any(String),
        path: "/",
        layout: "computer",
        user: `@ana ${"u".repeat(20)}`,
      },
      page: { route: { path: "/" }, layout: "computer", viewport: expect.any(Object) },
      user: { userId: "u".repeat(20), username: "ana" },
      logs: {
        errors: [{ at: 1, message: "TypeError: x is undefined" }],
        frames: [
          {
            direction: "sent",
            frame: { event: "resumeSeat", payload: { roomId: "ABC234", token: "[removed]" } },
          },
          { direction: "received" },
        ],
        console: [
          { level: "log", message: "claimed [removed]" },
          { level: "warn", message: "slow" },
        ],
        notices: [{ text: "it is not your turn" }],
      },
      storage: {
        local: {
          "hf.identity": { userId: "u".repeat(20), secret: "[removed]" },
          "hf.account": "ana",
          "hf.muted": true,
          "hf.savedGames": [{ roomId: "XYZ789", token: "[removed]" }],
        },
      },
      session: { status: expect.any(String) },
    });
    expect(report!.context!.storage).not.toHaveProperty(["local", "not.ours"]);
    expect(report!.context).not.toHaveProperty("table");
    expect(report).not.toHaveProperty("room");
    expectNoSecrets(report);

    fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a row in the settings on a phone", async () => {
    phone();
    const server = fakeServer();
    profile(server);
    fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));
    write("The menu would not open");
    send();
    await waitFor(() => expect(server.reports).toHaveLength(1));
    expect(server.reports[0]!.context).toMatchObject({ summary: { layout: "phone" } });
  });

  it("shows a refusal, keeps the words, and lets the player send again", async () => {
    const server = fakeServer([{ ok: false, error: "too many requests; try again in a minute" }]);
    profile(server);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    write("It froze");
    send();
    await waitFor(() =>
      expect(within(sheet()).getByRole("alert")).toHaveTextContent(
        "Too many requests; try again in a minute.",
      ),
    );
    expect(within(sheet()).getByRole("textbox", { name: /what went wrong/i })).toHaveValue(
      "It froze",
    );
    send();
    await waitFor(() => expect(within(sheet()).getByRole("status")).toHaveTextContent(/thanks/i));
    expect(server.reports).toHaveLength(2);
  });

  it("says so when the report never reached the server", async () => {
    profile(fakeServer([new Error("offline")]));
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    write("It froze");
    send();
    await waitFor(() =>
      expect(within(sheet()).getByRole("alert")).toHaveTextContent(
        `${REPORT_NOT_SENT.charAt(0).toUpperCase()}${REPORT_NOT_SENT.slice(1)}.`,
      ),
    );
  });

  it("says so when the server's answer was not one", async () => {
    profile(fakeServer([{} as Ack<unknown>]));
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    write("It froze");
    send();
    await waitFor(() => expect(within(sheet()).getByRole("alert")).toBeInTheDocument());
    expect(within(sheet()).getByRole("alert")).toHaveTextContent(/could not be sent/i);
  });

  it("thanks the player without a number when the server gave none", async () => {
    profile(fakeServer([{ ok: true, data: undefined }]));
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    write("It froze");
    send();
    await waitFor(() => expect(within(sheet()).getByRole("status")).toHaveTextContent(/thanks/i));
    expect(within(sheet()).getByRole("status")).not.toHaveTextContent(/report \d/);
  });

  it("sends nothing when cancelled", () => {
    const server = fakeServer();
    profile(server);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    write("Never mind");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(server.reports).toEqual([]);
  });
});

// At a table: the real table route, its menu, and the page's own `fetch`.

const card = (rank: Rank, suit: Suit | null, deck = 0): Card => ({
  id: `${rank}-${suit}-${deck}`,
  rank,
  suit,
});
const HAND = [card("A", "spades"), card("4", "hearts"), card("K", "clubs")];
const FOOT = [card("7", "diamonds")];
const MINE = [
  { rank: "Q" as Rank, cards: [card("Q", "hearts"), card("Q", "clubs"), card("Q", "spades")] },
];
const THEIRS = [
  {
    rank: "9" as Rank,
    cards: [card("9", "hearts", 1), card("9", "spades", 1), card("JOKER", null, 1)],
  },
];
const PILE = [card("5", "diamonds"), card("8", "hearts")];
const EVERY_CARD = [...HAND, ...FOOT, ...MINE[0]!.cards, ...THEIRS[0]!.cards, ...PILE];

function update(lastMove: LastMove, view: Partial<PlayerView> = {}): ViewUpdate {
  return {
    view: {
      seat: 0,
      hand: HAND,
      foot: null,
      footCount: 11,
      melds: MINE,
      isDown: true,
      inFoot: false,
      opponents: [
        { seat: 1, handCount: 8, footCount: 11, melds: THEIRS, isDown: true, inFoot: false },
      ],
      discard: PILE,
      stockCount: 40,
      currentSeat: 1,
      phase: "play",
      roundNumber: 2,
      pickedUp: [],
      playedThisTurn: [],
      wentOutSeat: null,
      finalLapRemaining: null,
      scoresSoFar: [90, 60],
      departed: [],
      ...view,
    },
    lastMove,
    clock: {
      serverNow: Date.now(),
      deadlineAt: Date.now() + 60_000,
      inDiscardGrace: false,
      paused: false,
    },
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

/** The page's own fetch, answering reports as the server does and recording them. */
function stubFetch(): ReportBody[] {
  const reports: ReportBody[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    expect(url).toMatch(/\/api\/reports$/);
    reports.push(JSON.parse(init.body) as ReportBody);
    return new Response(JSON.stringify({ ok: true, data: { id: reports.length - 1 } }), {
      headers: { "content-type": "application/json" },
    });
  });
  return reports;
}

function atTable(): void {
  window.localStorage.setItem(
    CREDENTIALS_KEY,
    JSON.stringify({ roomId: "ABC234", seat: 0, token: SEAT_TOKEN }),
  );
  window.sessionStorage.setItem(
    CREDENTIALS_KEY,
    JSON.stringify({ roomId: "ABC234", seat: 0, token: SEAT_TOKEN }),
  );
  useSession.setState({
    status: "connected",
    credentials: { roomId: "ABC234", seat: 0, token: SEAT_TOKEN },
    room: null,
    update: null,
    result: null,
    notice: null,
    reactions: [],
    clock: createServerClock(),
  });
  // Two moves arrive as the table is open, the second repeated by a later view.
  useSession.getState().applyUpdate(update({ seq: 7, seat: 1, kind: "takePile", count: 3 }));
  const socket = { emit: () => socket } as unknown as HfClientSocket;
  render(
    <MemoryRouter initialEntries={["/room/ABC234"]}>
      <Routes>
        <Route path="/room/:roomId" element={<Table socket={socket} />} />
      </Routes>
    </MemoryRouter>,
  );
  for (const move of [
    { seq: 8, seat: 1, kind: "discard", card: PILE[1]! },
    { seq: 8, seat: 1, kind: "discard", card: PILE[1]! },
    { seq: 9, seat: 0, kind: "draw", card: HAND[0]! },
  ] as LastMove[]) {
    act(() => useSession.getState().applyUpdate(update(move)));
  }
}

function openFromMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
  fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
}

describe("from the corner button, at a table", () => {
  it("sends the table as the menu's report does", async () => {
    const reports = stubFetch();
    atTable();
    render(<ReportButton />);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    expect(within(sheet()).getByText(TABLE_DISCLOSURE)).toBeInTheDocument();
    write("Something went wrong at the table");
    send();
    await waitFor(() => expect(reports).toHaveLength(1));
    const [report] = reports;
    expect(report!.room).toBe("ABC234");
    expect(report!.context).toMatchObject({
      summary: { room: "ABC234", seat: 0 },
      table: { own: { hand: HAND, melds: MINE } },
    });
    expectNoSecrets(report);
  });
});

describe("from the table's menu", () => {
  it("sends the whole table as this seat saw it, every card and the drawn one included, but no secret", async () => {
    const reports = stubFetch();
    atTable();
    openFromMenu();
    expect(within(sheet()).getByText(TABLE_DISCLOSURE)).toBeInTheDocument();
    expect(within(sheet()).queryByRole("checkbox")).toBeNull();
    write("Ben's discard went to the wrong place");
    send();
    await waitFor(() => expect(reports).toHaveLength(1));

    const [report] = reports;
    const json = JSON.stringify(report);
    // Every card on the table, the player's own draw too.
    for (const c of EVERY_CARD.filter((c) => !FOOT.includes(c))) expect(json).toContain(c.id);
    expect(report!.room).toBe("ABC234");
    expect(report!.context).toMatchObject({
      summary: { room: "ABC234", seat: 0, round: "2 of 4", phase: "play", seatToPlay: 1 },
      table: {
        room: { roomId: "ABC234" },
        update: { view: { hand: HAND, melds: MINE, opponents: [{ melds: THEIRS }] } },
        own: { hand: HAND, footCount: 11, melds: MINE },
        hints: { seatToAct: 1 },
        screen: { staging: { groups: [] }, chosenId: null, busy: false, watching: false },
        moveLines: ["ben took the pile (3 cards)", "ben discarded the 8♥", "You drew a card"],
        lastMoves: [
          { seq: 7, seat: 1, kind: "takePile", count: 3 },
          { seq: 8, seat: 1, kind: "discard", card: PILE[1] },
          { seq: 9, seat: 0, kind: "draw", card: HAND[0] },
        ],
      },
      session: {
        credentials: { roomId: "ABC234", seat: 0, token: "[removed]" },
        update: "the same as table.update",
      },
      storage: {
        local: { "hf.seat": { roomId: "ABC234", token: "[removed]" } },
        session: { "hf.seat": { roomId: "ABC234", token: "[removed]" } },
      },
    });
    expectNoSecrets(report);
    await waitFor(() => expect(within(sheet()).getByRole("status")).toHaveTextContent(/thanks/i));
  });

  it("is in the menu on a phone too", () => {
    phone();
    atTable();
    openFromMenu();
    expect(sheet()).toBeInTheDocument();
  });
});
