/**
 * Reporting a bug, as a player does it: from Profile, and from the table's menu
 * at a live table, through to what is posted and what the sheet says back.
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
import { ACCOUNT_KEY, IDENTITY_KEY, type Post } from "../identity";
import { ProfilePage } from "../pages/ProfilePage";
import { Table } from "../routes/Table";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { PHONE_QUERY } from "../usePhone";
import { forgetErrors, noteError } from "./errors";

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
  window.localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({ userId: "u".repeat(20), secret: "s".repeat(40) }),
  );
  window.localStorage.setItem(ACCOUNT_KEY, "ana");
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

    // The hint, and the list of what goes, in words; no table away from one.
    expect(within(sheet()).getByText(/what you were doing/i)).toBeInTheDocument();
    const list = within(sheet()).getByRole("region", { name: "Sent with your report" });
    expect(within(list).getByText("Version")).toBeInTheDocument();
    expect(within(list).getByText(`@ana, id ${"u".repeat(20)}`)).toBeInTheDocument();
    expect(within(list).getByText("the last 1 error on this page")).toBeInTheDocument();
    expect(within(list).queryByText("Table")).toBeNull();
    expect(within(sheet()).queryByRole("checkbox")).toBeNull();

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
      build: expect.any(String),
      path: "/",
      layout: "computer",
      userId: "u".repeat(20),
      username: "ana",
      errors: [{ at: 1, message: "TypeError: x is undefined" }],
    });
    expect(report!.context).not.toHaveProperty("table");
    // The secret never goes.
    expect(JSON.stringify(report)).not.toContain("s".repeat(40));

    fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows, folded, exactly the JSON it sends", async () => {
    const server = fakeServer();
    profile(server);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    write("It froze");
    const shown = JSON.parse(within(sheet()).getByLabelText("What is sent").textContent!);
    send();
    await waitFor(() => expect(server.reports).toHaveLength(1));
    expect(server.reports[0]!.context).toEqual(shown);
  });

  it("is a row in the settings on a phone", async () => {
    phone();
    const server = fakeServer();
    profile(server);
    fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));
    write("The menu would not open");
    send();
    await waitFor(() => expect(server.reports).toHaveLength(1));
    expect(server.reports[0]!.context).toMatchObject({ layout: "phone" });
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
  useSession.setState({
    status: "connected",
    credentials: { roomId: "ABC234", seat: 0, token: "t0" },
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

describe("from the table's menu", () => {
  it("sends the table's details and the player's own counts, never a card of anyone's", async () => {
    const reports = stubFetch();
    atTable();
    openFromMenu();
    const list = within(sheet()).getByRole("region", { name: "Sent with your report" });
    expect(within(list).getByText("ABC234, seat 0, round 2 of 4, play phase")).toBeInTheDocument();
    expect(
      within(list).getByText("how many only: 3 cards in hand, 11 in the foot, 1 meld"),
    ).toBeInTheDocument();
    write("Ben's discard went to the wrong place");
    send();
    await waitFor(() => expect(reports).toHaveLength(1));

    const json = JSON.stringify(reports[0]);
    // Of every card on the table, only the one the moves named (a public discard) is sent, not the player's own draw.
    expect(EVERY_CARD.filter((c) => json.includes(c.id)).map((c) => c.id)).toEqual([PILE[1]!.id]);
    for (const c of THEIRS[0]!.cards) expect(json).not.toContain(c.id);
    expect(reports[0]!.context).toMatchObject({
      path: "/",
      table: {
        room: "ABC234",
        seat: 0,
        round: 2,
        phase: "play",
        yourCards: { hand: 3, foot: 11, melds: 1 },
        moveLines: ["ben took the pile (3 cards)", "ben discarded the 8♥", "You drew a card"],
        lastMoves: [
          { seq: 7, seat: 1, kind: "takePile", count: 3 },
          { seq: 8, seat: 1, kind: "discard", card: PILE[1] },
          { seq: 9, seat: 0, kind: "draw" },
        ],
      },
    });
    await waitFor(() => expect(within(sheet()).getByRole("status")).toHaveTextContent(/thanks/i));
  });

  it("leaves the table out when the player asks", async () => {
    const reports = stubFetch();
    atTable();
    openFromMenu();
    fireEvent.click(within(sheet()).getByRole("checkbox", { name: /leave out this table/i }));
    expect(
      within(within(sheet()).getByRole("region", { name: "Sent with your report" })).queryByText(
        "Table",
      ),
    ).toBeNull();
    write("Something odd");
    send();
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]!.context).not.toHaveProperty("table");
    expect(JSON.stringify(reports[0])).not.toContain('ABC234"');
  });

  it("is in the menu on a phone too", () => {
    phone();
    atTable();
    openFromMenu();
    expect(sheet()).toBeInTheDocument();
  });
});
