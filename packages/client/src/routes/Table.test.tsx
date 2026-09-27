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
    pickedUp: [],
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

describe("staging a lay-down", () => {
  /** Ten cards that can make a real lay-down: three kings, four aces, spares. */
  function meldable(): Card[] {
    return [
      card("K", "clubs"),
      card("K", "hearts"),
      card("K", "spades"),
      card("A", "clubs"),
      card("A", "hearts"),
      card("A", "spades"),
      card("A", "diamonds"),
      card("2", "clubs"),
      card("9", "clubs"),
      card("3", "hearts"),
    ];
  }

  function inPlay(hand: Card[], over: Parameters<typeof update>[0] = {}): ViewUpdate {
    return update({
      ...over,
      view: { hand, phase: "play", ...over.view },
      hints: { phase: "play", canDraw: false, ...over.hints },
    });
  }

  it("shows nothing until a card is staged", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
  });

  it("opens a group when a natural is clicked", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    fireEvent.click(screen.getByRole("button", { name: "King of clubs" }));
    const panel = screen.getByLabelText(/lay-down being built/i);
    expect(within(panel).getByRole("button", { name: /Ks · wilds go here/i })).toBeInTheDocument();
  });

  it("runs a total against the round minimum as cards go in", () => {
    // The whole reason the panel exists: the minimum is checked across the lay-down
    // at once, so the total has to be visible before committing.
    mount(fakeSocket().socket, inPlay(meldable()));
    fireEvent.click(screen.getByRole("button", { name: "King of clubs" }));
    expect(screen.getByLabelText(/worth 10 of 60 needed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "King of hearts" }));
    expect(screen.getByLabelText(/worth 20 of 60 needed/i)).toBeInTheDocument();
  });

  it("will not commit a lay-down below the minimum, and says why", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    for (const name of ["King of clubs", "King of hearts", "King of spades"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(screen.getByRole("button", { name: /play these melds/i })).toBeDisabled();
    expect(screen.getByText(/below the round minimum of 60/i)).toBeInTheDocument();
  });

  it("commits a lay-down that clears the minimum", async () => {
    // Three kings and four aces: 30 + 60 = 90, over the 60 minimum.
    const { socket, sent } = fakeSocket();
    const hand = meldable();
    mount(socket, inPlay(hand));
    for (const name of [
      "King of clubs",
      "King of hearts",
      "King of spades",
      "Ace of clubs",
      "Ace of hearts",
      "Ace of spades",
      "Ace of diamonds",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    const commit = screen.getByRole("button", { name: /play these melds/i });
    expect(commit).not.toBeDisabled();
    fireEvent.click(commit);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].event).toBe("submitAction");
    const action = sent[0].args[0] as {
      type: string;
      melds: { rank: string; cardIds: string[] }[];
    };
    expect(action.type).toBe("playMelds");
    expect(action.melds.map((m) => m.rank)).toEqual(["K", "A"]);
    expect(action.melds[0].cardIds).toHaveLength(3);
    expect(action.melds[1].cardIds).toHaveLength(4);
  });

  it("sends a wild to the group the player was building", () => {
    // A wild has no rank of its own, so the focused group is what decides.
    mount(fakeSocket().socket, inPlay(meldable()));
    fireEvent.click(screen.getByRole("button", { name: "King of clubs" }));
    fireEvent.click(screen.getByRole("button", { name: "King of hearts" }));
    fireEvent.click(screen.getByRole("button", { name: "Two of clubs, wild" }));
    const panel = screen.getByLabelText(/lay-down being built/i);
    expect(within(panel).getByRole("button", { name: "Two of clubs, wild" })).toBeInTheDocument();
    // 10 + 10 + 20 for the two.
    expect(screen.getByLabelText(/worth 40 of 60 needed/i)).toBeInTheDocument();
  });

  it("refuses to stage a red three at all", () => {
    // It can never be melded, so it is not a staging target.
    mount(fakeSocket().socket, inPlay(meldable()));
    expect(screen.queryByRole("button", { name: /Three of hearts, penalty/i })).toBeNull();
    expect(screen.getByRole("img", { name: /Three of hearts, penalty/i })).toBeInTheDocument();
  });

  it("takes a card back when it is clicked again", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    fireEvent.click(screen.getByRole("button", { name: "King of clubs" }));
    expect(screen.getByLabelText(/lay-down being built/i)).toBeInTheDocument();
    // Clicking the same card in the hand unstages it, emptying the group.
    fireEvent.click(screen.getAllByRole("button", { name: "King of clubs" })[0]);
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
  });

  it("clears everything on take-them-back", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    fireEvent.click(screen.getByRole("button", { name: "King of clubs" }));
    fireEvent.click(screen.getByRole("button", { name: /take them back/i }));
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
  });

  it("stages nothing during the discard-only grace", () => {
    // Melding is closed then, so staging could only build a refused submission.
    mount(fakeSocket().socket, inPlay(meldable(), { clock: { inDiscardGrace: true } }));
    expect(screen.queryByRole("button", { name: "King of clubs" })).toBeNull();
  });

  it("offers no staging on someone else's turn", () => {
    mount(fakeSocket().socket, inPlay(meldable(), { hints: { seatToAct: 1 } }));
    expect(screen.queryByRole("button", { name: "King of clubs" })).toBeNull();
  });
});

describe("the take-pile obligation", () => {
  function withObligation(): ViewUpdate {
    const owed = card("7", "clubs");
    const other = card("K", "spades");
    return update({
      view: {
        hand: [owed, other],
        phase: "play",
        pickedUp: [owed.id],
      },
      hints: { phase: "play", canDraw: false },
    });
  }

  it("says the pile was taken and what is owed", () => {
    mount(fakeSocket().socket, withObligation());
    expect(screen.getByText(/play at least one of the ringed cards/i)).toBeInTheDocument();
  });

  it("blocks the discard until it is settled", () => {
    // The server would refuse it; an enabled button would only bounce.
    mount(fakeSocket().socket, withObligation());
    expect(screen.getByRole("button", { name: /^discard$/i })).toBeDisabled();
    expect(
      screen.getByText(/play a card from the pile before you can discard/i),
    ).toBeInTheDocument();
  });

  it("allows the discard once nothing is owed", () => {
    mount(
      fakeSocket().socket,
      update({
        view: { hand: [card("K", "spades")], phase: "play", pickedUp: [] },
        hints: { phase: "play", canDraw: false },
      }),
    );
    expect(screen.getByRole("button", { name: /^discard$/i })).not.toBeDisabled();
  });
});

describe("discarding", () => {
  function readyToDiscard(): ViewUpdate {
    return update({
      view: { hand: [card("K", "spades"), card("9", "hearts")], phase: "play" },
      hints: { phase: "play", canDraw: false },
    });
  }

  it("sends the card that is clicked once discard mode is on", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, readyToDiscard());
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(screen.getByText(/pick a card to discard/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nine of hearts" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const action = sent[0].args[0] as { type: string; cardId: string };
    expect(action.type).toBe("discard");
    expect(action.cardId).toBe("9-hearts");
  });

  it("can be cancelled", () => {
    mount(fakeSocket().socket, readyToDiscard());
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel discard/i }));
    expect(screen.queryByText(/pick a card to discard/i)).toBeNull();
  });

  it("is blocked while melds are staged", () => {
    // Playing them is a separate action; discarding first would throw the staged
    // lay-down away without saying so.
    mount(fakeSocket().socket, readyToDiscard());
    fireEvent.click(screen.getByRole("button", { name: "King of spades" }));
    expect(screen.getByRole("button", { name: /^discard$/i })).toBeDisabled();
    expect(screen.getByText(/play or take back your melds/i)).toBeInTheDocument();
  });

  it("is unavailable during the draw phase", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("button", { name: /^discard$/i })).toBeDisabled();
    expect(screen.getByText(/draw, or take the pile/i)).toBeInTheDocument();
  });
});

describe("when the turn ends without the player", () => {
  /** A socket whose acks are held until released, so a move can be caught in flight. */
  function heldSocket(): {
    socket: HfClientSocket;
    readonly sent: { event: string; args: unknown[] }[];
    release: () => void;
  } {
    const sent: { event: string; args: unknown[] }[] = [];
    const pending: ((result: Ack<unknown>) => void)[] = [];
    const socket = {
      emit: (event: string, ...args: unknown[]) => {
        sent.push({ event, args: args.slice(0, -1) });
        pending.push(args[args.length - 1] as (result: Ack<unknown>) => void);
        return socket;
      },
    } as unknown as HfClientSocket;
    return {
      socket,
      sent,
      release: () => pending.splice(0).forEach((ack) => ack({ ok: true, data: undefined })),
    };
  }

  const hand = [card("K", "clubs"), card("K", "hearts"), card("9", "hearts"), card("4", "spades")];
  const playing = (cards: Card[]): ViewUpdate =>
    update({ view: { hand: cards, phase: "play" }, hints: { phase: "play", canDraw: false } });
  // The clock ran out: the server discarded for the player and the turn passed.
  const passed = (cards: Card[]): ViewUpdate =>
    update({ view: { hand: cards, currentSeat: 1 }, hints: { seatToAct: 1, canDraw: false } });
  const deliver = (payload: ViewUpdate): void =>
    act(() => useSession.getState().applyUpdate(payload));

  it("leaves discard mode, so next turn's first click stages instead of discarding", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, playing(hand));
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(screen.getByText(/pick a card to discard/i)).toBeInTheDocument();

    const after = hand.filter((c) => c.id !== "4-spades");
    deliver(passed(after));
    expect(screen.queryByText(/pick a card to discard/i)).toBeNull();

    deliver(update({ view: { hand: after } }));
    fireEvent.click(screen.getByRole("button", { name: /^draw$/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    deliver(playing([...after, card("7", "clubs")]));

    expect(screen.getByRole("button", { name: /^discard$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "King of clubs" }));
    expect(sent).toHaveLength(1);
    expect(screen.getByLabelText(/lay-down being built/i)).toBeInTheDocument();
  });

  it("drops a staged lay-down when the turn passes", () => {
    mount(fakeSocket().socket, playing(hand));
    fireEvent.click(screen.getByRole("button", { name: "King of clubs" }));
    expect(screen.getByLabelText(/lay-down being built/i)).toBeInTheDocument();

    deliver(passed(hand));
    deliver(playing(hand));
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
    expect(screen.getByRole("button", { name: /^discard$/i })).not.toBeDisabled();
  });

  it("leaves discard mode when the round ends", () => {
    mount(fakeSocket().socket, playing(hand));
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    act(() => useSession.setState({ result: { scores: [], wentOutSeat: 1 } }));
    expect(screen.queryByText(/pick a card to discard/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Nine of hearts" })).toBeNull();
  });

  it("unstages a card the server has taken out of the hand", async () => {
    const kings = [
      card("K", "clubs"),
      card("K", "hearts"),
      card("K", "spades"),
      card("K", "diamonds"),
    ];
    const down = (cards: Card[]): ViewUpdate =>
      update({
        view: { hand: [...cards, card("9", "hearts")], phase: "play", isDown: true },
        hints: { phase: "play", canDraw: false },
      });
    const { socket, sent } = fakeSocket();
    mount(socket, down(kings));
    for (const suit of ["clubs", "hearts", "spades", "diamonds"]) {
      fireEvent.click(screen.getByRole("button", { name: `King of ${suit}` }));
    }

    deliver(down(kings.slice(0, 3)));
    fireEvent.click(screen.getByRole("button", { name: /play these melds/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const action = sent[0].args[0] as { melds: { rank: string; cardIds: string[] }[] };
    expect(action.melds).toEqual([{ rank: "K", cardIds: ["K-clubs", "K-hearts", "K-spades"] }]);
  });

  it("sends exactly one discard for two quick clicks", async () => {
    const { socket, sent, release } = heldSocket();
    mount(socket, playing(hand));
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Nine of hearts" }));
    fireEvent.click(screen.getByRole("button", { name: "Four of spades" }));
    await act(async () => release());
    expect(sent).toHaveLength(1);
  });
});

describe("going out", () => {
  it("says so when the books are in place", () => {
    mount(
      fakeSocket().socket,
      update({ hints: { canGoOut: true, phase: "play", canDraw: false }, view: { phase: "play" } }),
    );
    expect(screen.getByText(/books to go out/i)).toBeInTheDocument();
  });

  it("says nothing when they are not", () => {
    mount(fakeSocket().socket);
    expect(screen.queryByText(/books to go out/i)).toBeNull();
  });
});

describe("pausing", () => {
  it("is offered at a family table", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ event: "setPaused", args: [{ paused: true }] });
  });

  it("offers a resume while paused", () => {
    mount(fakeSocket().socket, update({ clock: { paused: true, deadlineAt: null } }));
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("is absent at a competitive table", () => {
    // Where pausing is disabled by the mode, so a button would only be refused.
    mount(
      fakeSocket().socket,
      update({ room: { config: { ...EAST_COAST, mode: "competitive", pauseEnabled: false } } }),
    );
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
  });
});

describe("adding to a book already on the table", () => {
  function alreadyDown(): ViewUpdate {
    const wild = card("2", "clubs");
    const spare = card("9", "hearts");
    return update({
      view: {
        hand: [wild, spare],
        phase: "play",
        isDown: true,
        melds: [
          {
            rank: "K",
            cards: [card("K", "clubs"), card("K", "hearts"), card("K", "spades")],
          },
        ],
      },
      hints: { phase: "play", canDraw: false },
    });
  }

  it("offers a way in for each book down", () => {
    mount(fakeSocket().socket, alreadyDown());
    expect(screen.getByRole("button", { name: /add to Ks/i })).toBeInTheDocument();
  });

  it("lets a wild be aimed at that book with no natural to open a group", () => {
    // The case that needs the affordance: there is no king left in hand to start a
    // group, so without focusing the rank the wild would have nowhere to go.
    const { socket, sent } = fakeSocket();
    mount(socket, alreadyDown());
    fireEvent.click(screen.getByRole("button", { name: /add to Ks/i }));
    fireEvent.click(screen.getByRole("button", { name: "Two of clubs, wild" }));

    const panel = screen.getByLabelText(/lay-down being built/i);
    expect(within(panel).getByRole("button", { name: "Two of clubs, wild" })).toBeInTheDocument();
    // Four cards with the wild. Not a book yet — a book is seven — so the size is
    // shown with no kind against it. The text spans two nodes, hence textContent.
    expect(panel.textContent).toMatch(/4 total/);
    expect(panel.textContent).not.toMatch(/dirty|clean/);

    fireEvent.click(screen.getByRole("button", { name: /play these melds/i }));
    return waitFor(() => {
      expect(sent).toHaveLength(1);
      const action = sent[0].args[0] as { type: string; melds: { rank: string }[] };
      expect(action.type).toBe("playMelds");
      expect(action.melds).toEqual([{ rank: "K", cardIds: ["2-clubs"] }]);
    });
  });

  it("moves the focus between groups when another is chosen", () => {
    mount(fakeSocket().socket, alreadyDown());
    // Start a nines group from the hand, then aim back at the kings.
    fireEvent.click(screen.getByRole("button", { name: "Nine of hearts" }));
    const panel = screen.getByLabelText(/lay-down being built/i);
    expect(within(panel).getByRole("button", { name: /9s · wilds go here/i })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /^9s · wilds go here$/i }));
    expect(within(panel).getByRole("button", { name: /9s · wilds go here/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows no way in before the player is down", () => {
    // There are no books to add to yet, so the affordance would be meaningless.
    mount(
      fakeSocket().socket,
      update({ view: { phase: "play" }, hints: { phase: "play", canDraw: false } }),
    );
    expect(screen.queryByRole("button", { name: /add to/i })).toBeNull();
  });
});
