import { describe, it, expect, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  EAST_COAST,
  type Ack,
  type Card,
  type LegalHints,
  type PlayerView,
  type Rank,
  type RoomInfo,
  type Suit,
  type ViewUpdate,
} from "@hf/shared";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Table } from "./Table";

const card = (rank: Rank, suit: Suit | null): Card => ({ id: `${rank}-${suit}`, rank, suit });

function fakeSocket(answers: Ack<unknown>[] = []): {
  socket: HfClientSocket;
  readonly sent: { event: string; args: unknown[] }[];
} {
  const sent: { event: string; args: unknown[] }[] = [];
  const queue = [...answers];
  const socket = {
    emit: (event: string, ...args: unknown[]) => {
      const ack = args[args.length - 1] as (result: Ack<unknown>) => void;
      sent.push({ event, args: args.slice(0, -1) });
      ack(queue.shift() ?? { ok: true, data: undefined });
      return socket;
    },
  } as unknown as HfClientSocket;
  return { socket, sent };
}

function roomInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    roomId: "ABC234",
    players: [
      { seat: 0, name: "ana", connected: true },
      { seat: 1, name: "ben", connected: true },
    ],
    hostSeat: 0,
    started: true,
    config: EAST_COAST,
    ...overrides,
  };
}

function update(
  overrides: {
    view?: Partial<PlayerView>;
    hints?: Partial<LegalHints>;
    room?: Partial<RoomInfo>;
    clock?: Partial<ViewUpdate["clock"]>;
  } = {},
): ViewUpdate {
  const view: PlayerView = {
    seat: 0,
    hand: [card("A", "spades"), card("4", "hearts")],
    foot: null,
    footCount: 14,
    melds: [],
    isDown: false,
    inFoot: false,
    opponents: [{ seat: 1, handCount: 11, footCount: 14, melds: [], isDown: false, inFoot: false }],
    discard: [card("9", "clubs")],
    stockCount: 40,
    currentSeat: 0,
    phase: "draw",
    roundNumber: 1,
    ...overrides.view,
  };
  return {
    view,
    room: roomInfo(overrides.room),
    clock: {
      serverNow: 1_000,
      deadlineAt: 61_000,
      inDiscardGrace: false,
      paused: false,
      ...overrides.clock,
    },
    hints: {
      seatToAct: 0,
      phase: view.phase,
      canDraw: true,
      canTakePile: false,
      meldableRanks: [],
      canGoOut: false,
      ...overrides.hints,
    },
  };
}

function mount(socket: HfClientSocket, payload: ViewUpdate | null = update()): void {
  if (payload) useSession.getState().applyUpdate(payload);
  render(<Table socket={socket} />);
}

beforeEach(() => {
  useSession.setState({
    status: "connected",
    credentials: { roomId: "ABC234", seat: 0, token: "t0" },
    room: null,
    update: null,
    result: null,
    notice: null,
    clock: createServerClock(),
  });
});

describe("before the first view", () => {
  it("says it is dealing rather than drawing an empty table", () => {
    mount(fakeSocket().socket, null);
    expect(screen.getByText(/dealing/i)).toBeInTheDocument();
  });
});

describe("your own cards", () => {
  it("shows the hand, each card named", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("img", { name: "Ace of spades" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Four of hearts" })).toBeInTheDocument();
  });

  it("counts the hand and its wilds", () => {
    mount(
      fakeSocket().socket,
      update({ view: { hand: [card("2", "clubs"), card("JOKER", null), card("A", "spades")] } }),
    );
    expect(screen.getByRole("heading", { name: /your hand \(3\)/i })).toBeInTheDocument();
    expect(screen.getByText(/2 wild/)).toBeInTheDocument();
  });

  it("shows the foot face down until it is picked up", () => {
    // The server sends a count and no cards before then, so a back is all there is.
    mount(fakeSocket().socket);
    expect(screen.getByRole("img", { name: "Your foot: 14" })).toBeInTheDocument();
  });

  it("shows the foot's cards once in it, and stops showing a back", () => {
    mount(
      fakeSocket().socket,
      update({ view: { inFoot: true, foot: [card("K", "diamonds")], hand: [] } }),
    );
    expect(screen.getByRole("heading", { name: /your foot \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "King of diamonds" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /your foot: / })).toBeNull();
  });

  it("explains that a cardless player still takes a turn", () => {
    // Shedding every card is not going out; they keep drawing one a turn. Saying
    // nothing here would look like a broken screen.
    mount(fakeSocket().socket, update({ view: { hand: [], inFoot: true, foot: [] } }));
    expect(screen.getByText(/you still take a turn/i)).toBeInTheDocument();
  });
});

describe("the piles", () => {
  it("shows the stock as a count, never as cards", () => {
    // Deck order never leaves the server; there is nothing here to draw.
    mount(fakeSocket().socket);
    expect(screen.getByRole("img", { name: "Stock: 40" })).toBeInTheDocument();
  });

  it("draws only the top discard", () => {
    mount(
      fakeSocket().socket,
      update({ view: { discard: [card("5", "spades"), card("9", "clubs")] } }),
    );
    expect(screen.getByText(/discard \(2\)/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Nine of clubs" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Five of spades" })).toBeNull();
  });

  it("says when the pile is empty", () => {
    mount(fakeSocket().socket, update({ view: { discard: [] } }));
    expect(screen.getByText(/^empty$/i)).toBeInTheDocument();
  });
});

describe("the other seats", () => {
  it("shows counts and never an opponent's cards", () => {
    mount(fakeSocket().socket);
    const seat = screen.getByLabelText(/ben, 11 in hand, 14 in foot, not down/i);
    expect(seat).toBeInTheDocument();
  });

  it("marks who is on turn", () => {
    mount(fakeSocket().socket, update({ hints: { seatToAct: 1 }, view: { currentSeat: 1 } }));
    expect(screen.getByLabelText(/ben,.*to play/i)).toBeInTheDocument();
  });

  it("marks a seat that has dropped", () => {
    // It explains why moves are happening: the server plays an absent seat's turns.
    mount(
      fakeSocket().socket,
      update({
        room: {
          players: [
            { seat: 0, name: "ana", connected: true },
            { seat: 1, name: "ben", connected: false },
          ],
        },
      }),
    );
    expect(screen.getByLabelText(/ben, 11 in hand/i)).toBeInTheDocument();
  });

  it("says when an opponent is playing from their foot", () => {
    // It is the point of no return in the game: they have no hand left to come back
    // from, so it belongs on screen rather than being inferred from a count.
    mount(
      fakeSocket().socket,
      update({
        view: {
          opponents: [
            { seat: 1, handCount: 0, footCount: 9, melds: [], isDown: true, inFoot: true },
          ],
        },
      }),
    );
    expect(screen.getByLabelText(/playing from the foot/i)).toBeInTheDocument();
    expect(screen.getByText(/foot \(in\)/i)).toBeInTheDocument();
  });

  it("falls back to a seat number for a player the room does not name", () => {
    // Defensive: the view and the room arrive in separate payloads, so a seat could
    // in principle appear in one before the other.
    mount(
      fakeSocket().socket,
      update({ room: { players: [{ seat: 0, name: "ana", connected: true }] } }),
    );
    expect(screen.getByLabelText(/^Seat 1, 11 in hand/i)).toBeInTheDocument();
  });

  it("shows an opponent's melds", () => {
    mount(
      fakeSocket().socket,
      update({
        view: {
          opponents: [
            {
              seat: 1,
              handCount: 5,
              footCount: 14,
              melds: [
                {
                  rank: "K",
                  cards: [card("K", "clubs"), card("K", "hearts"), card("K", "spades")],
                },
              ],
              isDown: true,
              inFoot: false,
            },
          ],
        },
      }),
    );
    expect(screen.getByLabelText(/meld of Ks, 3 cards/i)).toBeInTheDocument();
  });
});

describe("your melds", () => {
  it("says so when you are not down", () => {
    // Scoped to your own section: the opponent panel says the same of them, and an
    // unscoped query cannot tell the two apart.
    mount(fakeSocket().socket);
    const mine = screen.getByLabelText(/your melds/i);
    expect(within(mine).getByText(/not down yet/i)).toBeInTheDocument();
  });

  it("labels a clean book and its points", () => {
    // The kind comes from the engine's classifyBook, so the label cannot disagree
    // with what scoring will award.
    const sevenAces = Array.from({ length: 7 }, (_, i) => ({
      id: `a${i}`,
      rank: "A" as Rank,
      suit: "spades" as Suit,
    }));
    mount(
      fakeSocket().socket,
      update({ view: { isDown: true, melds: [{ rank: "A", cards: sevenAces }] } }),
    );
    expect(screen.getByLabelText(/clean book of As, 7 cards/i)).toBeInTheDocument();
  });

  it("shows the round's minimum and whether you are down", () => {
    mount(fakeSocket().socket, update({ view: { isDown: true } }));
    expect(screen.getByText(/you are down/i)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`minimum ${EAST_COAST.layDownMinimums[0]}`)),
    ).toBeInTheDocument();
  });
});

describe("taking a turn", () => {
  it("offers a draw when the server says one is open", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: /^draw$/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ event: "submitAction", args: [{ type: "draw" }] });
  });

  it("refuses a draw the server has closed", () => {
    // After drawing, canDraw goes false; an enabled button would only bounce.
    mount(fakeSocket().socket, update({ hints: { canDraw: false, phase: "play" } }));
    expect(screen.getByRole("button", { name: /^draw$/i })).toBeDisabled();
  });

  it("offers the pile only when the server says it can be taken", () => {
    // Whether the pile is takeable is decided by a solver over the whole state, so
    // the client cannot second-guess it.
    mount(fakeSocket().socket);
    expect(screen.getByRole("button", { name: /take the pile/i })).toBeDisabled();

    // Through act, because a store write from outside React is not flushed otherwise.
    act(() => {
      useSession.setState({ update: update({ hints: { canTakePile: true } }) });
    });
    expect(screen.getByRole("button", { name: /take the pile/i })).not.toBeDisabled();
  });

  it("sends takePile", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, update({ hints: { canTakePile: true } }));
    fireEvent.click(screen.getByRole("button", { name: /take the pile/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args).toEqual([{ type: "takePile" }]);
  });

  it("offers nothing on someone else's turn, and says whose it is", () => {
    mount(fakeSocket().socket, update({ hints: { seatToAct: 1 } }));
    expect(screen.queryByRole("button", { name: /^draw$/i })).toBeNull();
    expect(screen.getByText(/waiting for ben/i)).toBeInTheDocument();
  });

  it("surfaces a refused move verbatim", async () => {
    // Engine errors are written for a player to read.
    const { socket } = fakeSocket([{ ok: false, error: "you have already drawn this turn" }]);
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: /^draw$/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/already drawn this turn/i),
    );
  });
});

describe("the round result", () => {
  it("shows the scores and who went out", () => {
    mount(fakeSocket().socket);
    act(() => {
      useSession.setState({
        result: {
          scores: [
            { seat: 0, score: 415 },
            { seat: 1, score: -20 },
          ],
          wentOutSeat: 0,
        },
      });
    });
    const panel = screen.getByLabelText(/round result/i);
    expect(panel.textContent).toMatch(/ana: 415/);
    expect(panel.textContent).toMatch(/ben: -20/);
    expect(panel.textContent).toMatch(/went out/);
  });

  it("stops the clock and the turn once the round is over, even if a deadline arrives", () => {
    // The update still names a seat to act and carries a live deadline; the result
    // alone has to end the turn on screen.
    mount(fakeSocket().socket, update({ hints: { seatToAct: 1 } }));
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByText(/waiting for ben/i)).toBeInTheDocument();
    act(() => {
      useSession.getState().applyResult({
        scores: [
          { seat: 0, score: 415 },
          { seat: 1, score: -20 },
        ],
        wentOutSeat: 0,
      });
    });
    expect(screen.getByLabelText(/round result/i)).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(/waiting for/i)).toBeNull();
    expect(screen.queryByLabelText(/your turn/i)).toBeNull();
  });

  it("offers no draw to the seat on turn once the round is over", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("button", { name: /^draw$/i })).toBeInTheDocument();
    act(() => {
      useSession.getState().applyResult({ scores: [{ seat: 0, score: 0 }] });
    });
    expect(screen.queryByRole("button", { name: /^draw$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /take the pile/i })).toBeNull();
  });
});

describe("the clock", () => {
  it("counts down from the server's deadline, not the browser's clock", () => {
    // The browser reads 0 in jsdom while the server said 1_000, so the offset is
    // what makes 61_000 read as a minute rather than as a minute past the epoch.
    mount(fakeSocket().socket);
    expect(screen.getByRole("timer").textContent).toMatch(/1:00/);
  });

  it("says when the table is paused", () => {
    mount(fakeSocket().socket, update({ clock: { deadlineAt: null, paused: true } }));
    expect(screen.getByRole("timer").textContent).toMatch(/—/);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it("says when only a discard will be accepted", () => {
    mount(fakeSocket().socket, update({ clock: { inDiscardGrace: true } }));
    expect(screen.getByText(/discard only/i)).toBeInTheDocument();
  });
});
