import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  EAST_COAST,
  type Ack,
  type Card,
  type LegalHints,
  type PlayerView,
  type Rank,
  type RoomInfo,
  type RoundEnded,
  type Suit,
  type ViewUpdate,
} from "@hf/shared";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { evenRows, Hand, perRow } from "../table/Hand";
import { PHONE_QUERY } from "../usePhone";
import { Table } from "./Table";

const card = (rank: Rank, suit: Suit | null): Card => ({ id: `${rank}-${suit}`, rank, suit });

/**
 * A socket that records what was sent and answers with a queued ack. The drafts the
 * table syncs in the background while melds are staged are kept apart in `drafts`,
 * so `sent` holds only what the player actually asked for.
 */
function fakeSocket(answers: Ack<unknown>[] = []): {
  socket: HfClientSocket;
  readonly sent: { event: string; args: unknown[] }[];
  readonly drafts: unknown[];
} {
  const sent: { event: string; args: unknown[] }[] = [];
  const drafts: unknown[] = [];
  const queue = [...answers];
  const socket = {
    emit: (event: string, ...args: unknown[]) => {
      const ack = args[args.length - 1] as (result: Ack<unknown>) => void;
      if (event === "stageMelds") {
        drafts.push((args[0] as { melds: unknown }).melds);
        ack({ ok: true, data: undefined });
        return socket;
      }
      sent.push({ event, args: args.slice(0, -1) });
      ack(queue.shift() ?? { ok: true, data: undefined });
      return socket;
    },
  } as unknown as HfClientSocket;
  return { socket, sent, drafts };
}

/** The hand's own copy of a card, not the one lifted into the lay-down panel. */
function handCard(name: string): HTMLElement {
  return within(screen.getByRole("region", { name: /^your (hand|foot)$/i })).getByRole("button", {
    name,
  });
}

/** Click a card, then an entry on the menu it opens. */
function choose(name: string, item: RegExp): void {
  fireEvent.click(handCard(name));
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

/**
 * Stage a card into a meld, the way a player does: the first through the card's
 * menu, and every one after with a plain click, once a lay-down is under way.
 */
function meld(name: string): void {
  if (screen.queryByLabelText(/lay-down being built/i)) fireEvent.click(handCard(name));
  else choose(name, /^(meld|add to .*)$/i);
}

/**
 * A round result with a breakdown whose parts add up to each score. The match is
 * over unless said otherwise, and the totals are the round's scores.
 */
function scored(
  scores: [number, number][],
  wentOutSeat?: number,
  match: { matchOver?: boolean; roundNumber?: number; totals?: number[] } = {},
): RoundEnded {
  return {
    scores: scores.map(([seat, score]) => ({
      seat,
      score,
      breakdown: {
        cleanBooks: 0,
        dirtyBooks: 0,
        bookBonus: 0,
        meldedCards: score,
        goOutBonus: 0,
        heldCount: 0,
        heldPenalty: 0,
      },
    })),
    wentOutSeat,
    roundNumber: match.roundNumber ?? 4,
    totals: match.totals ?? scores.map(([, score]) => score),
    matchOver: match.matchOver ?? true,
  };
}

function roomInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    roomId: "ABC234",
    players: [
      { seat: 0, name: "ana", connected: true },
      { seat: 1, name: "ben", connected: true },
    ],
    hostSeat: 0,
    playAgain: [],
    nextRoundReady: [],
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
    lastMove?: ViewUpdate["lastMove"];
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
    playedThisTurn: [],
    wentOutSeat: null,
    finalLapRemaining: null,
    scoresSoFar: [],
    ...overrides.view,
  };
  return {
    view,
    ...(overrides.lastMove ? { lastMove: overrides.lastMove } : {}),
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
  render(
    <MemoryRouter initialEntries={["/room/ABC234"]}>
      <Routes>
        <Route path="/room/:roomId" element={<Table socket={socket} />} />
        <Route path="/" element={<p>main screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
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
    mount(fakeSocket().socket, update({ hints: { canDraw: false } }));
    expect(screen.getByRole("img", { name: "Stock: 40" })).toBeInTheDocument();
  });

  it("draws one discard as one card", () => {
    mount(fakeSocket().socket, update({ view: { discard: [card("9", "clubs")] } }));
    const pile = screen.getByRole("img", { name: "Discard pile, 1 card, Nine of clubs on top" });
    // One face: a rank and a suit.
    expect(pile.querySelectorAll("text")).toHaveLength(2);
  });

  it("draws two discards as two cards, the one beneath peeking out", () => {
    mount(
      fakeSocket().socket,
      update({ view: { discard: [card("5", "spades"), card("9", "clubs")] } }),
    );
    expect(screen.getByText(/discard \(2\)/i)).toBeInTheDocument();
    const pile = screen.getByRole("img", { name: "Discard pile, 2 cards, Nine of clubs on top" });
    expect([...pile.querySelectorAll("text")].map((t) => t.textContent)).toEqual([
      "5",
      "♠",
      "9",
      "♣",
    ]);
  });

  it("draws three or more discards as a stack, showing only the top card's face", () => {
    mount(
      fakeSocket().socket,
      update({
        view: { discard: [card("5", "spades"), card("7", "hearts"), card("9", "clubs")] },
      }),
    );
    const pile = screen.getByRole("img", { name: "Discard pile, 3 cards, Nine of clubs on top" });
    expect(pile.querySelectorAll("text")).toHaveLength(2);
    expect(pile.textContent).not.toMatch(/5|7/);
  });

  it("says when the pile is empty", () => {
    mount(fakeSocket().socket, update({ view: { discard: [] } }));
    expect(screen.getByRole("img", { name: "Discard pile, empty" })).toBeInTheDocument();
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
    // Collapsed to one stacked card: seven fanned aces would say less, less clearly.
    expect(screen.getByRole("img", { name: /clean book of As, 7 cards/i })).toBeInTheDocument();
    const mine = screen.getByLabelText(/your melds/i);
    expect(within(mine).queryByRole("img", { name: "Ace of spades" })).toBeNull();
  });

  it("keeps a meld still being built fanned out, card by card", () => {
    mount(
      fakeSocket().socket,
      update({
        view: {
          isDown: true,
          melds: [
            { rank: "9", cards: [card("9", "clubs"), card("9", "hearts"), card("9", "spades")] },
          ],
        },
      }),
    );
    expect(screen.getByRole("img", { name: "Nine of hearts" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /book of 9s/i })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: /^draw a card/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ event: "submitAction", args: [{ type: "draw" }] });
  });

  it("refuses a draw the server has closed", () => {
    // After drawing, canDraw goes false; an enabled button would only bounce.
    // The stock is only a button while a draw is open; otherwise it is a picture.
    mount(fakeSocket().socket, update({ hints: { canDraw: false, phase: "play" } }));
    expect(screen.queryByRole("button", { name: /^draw a card/i })).toBeNull();
    expect(screen.getByRole("img", { name: "Stock: 40" })).toBeInTheDocument();
  });

  it("offers the pile only when the server says it can be taken", () => {
    // Whether the pile is takeable is decided by a solver over the whole state, so
    // the client cannot second-guess it.
    mount(fakeSocket().socket);
    expect(screen.queryByRole("button", { name: /take the pile/i })).toBeNull();

    // Through act, because a store write from outside React is not flushed otherwise.
    act(() => {
      useSession.setState({ update: update({ hints: { canTakePile: true } }) });
    });
    expect(screen.getByRole("button", { name: /take the pile \(1 cards\)/i })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /^draw a card/i })).toBeNull();
    expect(screen.getByText(/waiting for ben/i)).toBeInTheDocument();
  });

  it("surfaces a refused move verbatim", async () => {
    // Engine errors are written for a player to read.
    const { socket } = fakeSocket([{ ok: false, error: "you have already drawn this turn" }]);
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: /^draw a card/i }));
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
        result: scored(
          [
            [0, 415],
            [1, -20],
          ],
          0,
        ),
      });
    });
    const panel = screen.getByLabelText(/round result/i);
    expect(within(panel).getByRole("row", { name: "ana: 415" })).toBeInTheDocument();
    expect(within(panel).getByRole("row", { name: "ben: -20" })).toBeInTheDocument();
  });

  it("breaks each score into books, cards melded, going out, and cards left", () => {
    mount(fakeSocket().socket);
    const { cleanBookBonus, dirtyBookBonus, goOutBonus } = EAST_COAST.scoring;
    act(() => {
      useSession.setState({
        result: {
          wentOutSeat: 0,
          roundNumber: 1,
          totals: [2 * cleanBookBonus + dirtyBookBonus + 185 + goOutBonus, 40 - 520],
          matchOver: false,
          scores: [
            {
              seat: 0,
              score: 2 * cleanBookBonus + dirtyBookBonus + 185 + goOutBonus,
              breakdown: {
                cleanBooks: 2,
                dirtyBooks: 1,
                bookBonus: 2 * cleanBookBonus + dirtyBookBonus,
                meldedCards: 185,
                goOutBonus,
                heldCount: 0,
                heldPenalty: 0,
              },
            },
            {
              seat: 1,
              score: 40 - 520,
              breakdown: {
                cleanBooks: 0,
                dirtyBooks: 0,
                bookBonus: 0,
                meldedCards: 40,
                goOutBonus: 0,
                heldCount: 3,
                heldPenalty: -520,
              },
            },
          ],
        },
      });
    });
    const ana = screen.getByRole("row", { name: /^ana:/ });
    expect(ana.textContent).toContain(`2 × ${cleanBookBonus} = +${2 * cleanBookBonus}`);
    expect(ana.textContent).toContain(`1 × ${dirtyBookBonus} = +${dirtyBookBonus}`);
    expect(ana.textContent).toContain("+185");
    expect(ana.textContent).toContain(`+${goOutBonus}`);
    const ben = screen.getByRole("row", { name: /^ben:/ });
    expect(ben.textContent).toContain("3 cards: -520");
    expect(ben.textContent).toContain("—");
    // Highest score first.
    const rows = within(screen.getByLabelText(/round result/i))
      .getAllByRole("row")
      .slice(1);
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      `ana: ${2 * cleanBookBonus + dirtyBookBonus + 185 + goOutBonus}`,
      "ben: -480",
    ]);
  });

  it("stops the clock and the turn once the round is over, even if a deadline arrives", () => {
    // The update still names a seat to act and carries a live deadline; the result
    // alone has to end the turn on screen.
    mount(fakeSocket().socket, update({ hints: { seatToAct: 1 } }));
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByText(/waiting for ben/i)).toBeInTheDocument();
    act(() => {
      useSession.getState().applyResult(
        scored(
          [
            [0, 415],
            [1, -20],
          ],
          0,
        ),
      );
    });
    expect(screen.getByLabelText(/round result/i)).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByText(/waiting for/i)).toBeNull();
    expect(screen.queryByLabelText(/your turn/i)).toBeNull();
  });

  it("offers no draw to the seat on turn once the round is over", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("button", { name: /^draw a card/i })).toBeInTheDocument();
    act(() => {
      useSession.getState().applyResult(scored([[0, 0]]));
    });
    expect(screen.queryByRole("button", { name: /^draw a card/i })).toBeNull();
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

  it("opens a group, selected, when a natural is melded", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    meld("King of clubs");
    const panel = screen.getByLabelText(/lay-down being built/i);
    expect(within(panel).getByRole("button", { name: "Select the Ks meld" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // No tag to explain the selection: the highlighted box is the selection.
    expect(panel.textContent).not.toMatch(/wilds go here/i);
  });

  it("offers a card's choices in a menu rather than acting on the first click", () => {
    const { socket, sent } = fakeSocket();
    mount(socket, inPlay(meldable()));
    fireEvent.click(handCard("King of clubs"));
    const menu = screen.getByRole("menu", { name: /card actions/i });
    expect(within(menu).getByRole("menuitem", { name: "Meld" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Discard" })).toBeInTheDocument();
    expect(sent).toEqual([]);
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Cancel" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("adds further cards with a plain click once a lay-down is under way", () => {
    // The player has already chosen to meld; a menu for every card would be noise.
    mount(fakeSocket().socket, inPlay(meldable()));
    meld("King of clubs");
    fireEvent.click(handCard("King of hearts"));
    fireEvent.click(handCard("Two of clubs, wild"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByLabelText(/worth 40 of 60 needed/i)).toBeInTheDocument();
    // And a plain click on a staged card takes it back.
    fireEvent.click(handCard("King of hearts"));
    expect(screen.getByLabelText(/worth 30 of 60 needed/i)).toBeInTheDocument();
    // A red three can never be melded, so clicking one changes nothing.
    fireEvent.click(handCard("Three of hearts, penalty"));
    expect(screen.getByLabelText(/worth 30 of 60 needed/i)).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the server's copy of the lay-down current as it is built", () => {
    // So the server can play it if the clock runs out before the player does.
    const { socket, drafts } = fakeSocket();
    mount(socket, inPlay(meldable()));
    meld("King of clubs");
    meld("King of hearts");
    expect(drafts.at(-1)).toEqual([{ rank: "K", cardIds: ["K-clubs", "K-hearts"] }]);
    fireEvent.click(screen.getByRole("button", { name: /take them back/i }));
    expect(drafts.at(-1)).toEqual([]);
  });

  it("sends no draft outside the play phase", () => {
    const { socket, drafts } = fakeSocket();
    mount(socket);
    expect(drafts).toEqual([]);
  });

  it("runs a total against the round minimum as cards go in", () => {
    // The whole reason the panel exists: the minimum is checked across the lay-down
    // at once, so the total has to be visible before committing.
    mount(fakeSocket().socket, inPlay(meldable()));
    meld("King of clubs");
    expect(screen.getByLabelText(/worth 10 of 60 needed/i)).toBeInTheDocument();
    meld("King of hearts");
    expect(screen.getByLabelText(/worth 20 of 60 needed/i)).toBeInTheDocument();
  });

  it("will not commit a lay-down below the minimum, and says why", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    for (const name of ["King of clubs", "King of hearts", "King of spades"]) meld(name);
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
      meld(name);
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

  it("sends a wild to the selected group, and names that group before it goes", () => {
    // A wild has no rank of its own, so the selected group is what decides.
    mount(fakeSocket().socket, inPlay(meldable()));
    meld("King of clubs");
    meld("King of hearts");
    meld("Two of clubs, wild");
    const panel = screen.getByLabelText(/lay-down being built/i);
    expect(within(panel).getByRole("button", { name: "Two of clubs, wild" })).toBeInTheDocument();
    // 10 + 10 + 20 for the two.
    expect(screen.getByLabelText(/worth 40 of 60 needed/i)).toBeInTheDocument();
  });

  it("asks for a meld to be selected before a wild can join one", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    fireEvent.click(handCard("Two of clubs, wild"));
    expect(screen.getByRole("menuitem", { name: /select a meld for it first/i })).toBeDisabled();
  });

  it("never offers to meld a red three", () => {
    // It can never be melded; it can still be thrown away.
    mount(fakeSocket().socket, inPlay(meldable()));
    fireEvent.click(handCard("Three of hearts, penalty"));
    expect(screen.queryByRole("menuitem", { name: /meld/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Discard" })).toBeInTheDocument();
  });

  it("takes a card back from the hand, or straight from the panel", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    meld("King of clubs");
    fireEvent.click(handCard("King of clubs"));
    // Still in meld mode, with nothing picked: the panel says how it works.
    expect(screen.getByLabelText(/lay-down being built/i).textContent).toMatch(
      /click cards in your hand/i,
    );

    meld("King of clubs");
    const panel = screen.getByLabelText(/lay-down being built/i);
    fireEvent.click(within(panel).getByRole("button", { name: "King of clubs" }));
    expect(screen.getByLabelText(/lay-down being built/i).textContent).toMatch(
      /click cards in your hand/i,
    );
  });

  it("selects a group by clicking its box", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    meld("King of clubs");
    meld("Ace of clubs");
    const panel = screen.getByLabelText(/lay-down being built/i);
    const kings = within(panel).getByRole("button", { name: "Select the Ks meld" });
    expect(kings).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(kings.closest("li")!);
    expect(kings).toHaveAttribute("aria-pressed", "true");
  });

  it("clears everything on take-them-back", () => {
    mount(fakeSocket().socket, inPlay(meldable()));
    meld("King of clubs");
    fireEvent.click(screen.getByRole("button", { name: /take them back/i }));
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
  });

  it("offers only the discard during the discard-only grace", () => {
    // Melding is closed then, so staging could only build a refused submission.
    mount(fakeSocket().socket, inPlay(meldable(), { clock: { inDiscardGrace: true } }));
    fireEvent.click(handCard("King of clubs"));
    expect(screen.queryByRole("menuitem", { name: "Meld" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Discard" })).toBeInTheDocument();
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

  it("offers no discard until it is settled", () => {
    // The server would refuse it, so the card's menu does not offer one.
    mount(fakeSocket().socket, withObligation());
    fireEvent.click(handCard("King of spades"));
    expect(screen.queryByRole("menuitem", { name: "Discard" })).toBeNull();
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
    fireEvent.click(handCard("King of spades"));
    expect(screen.getByRole("menuitem", { name: "Discard" })).not.toBeDisabled();
  });
});

describe("discarding", () => {
  function readyToDiscard(over: Partial<PlayerView> = {}): ViewUpdate {
    return update({
      view: { hand: [card("K", "spades"), card("9", "hearts")], phase: "play", ...over },
      hints: { phase: "play", canDraw: false },
    });
  }

  it("sends the card chosen from its menu", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, readyToDiscard());
    choose("Nine of hearts", /^discard$/i);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args[0]).toEqual({ type: "discard", cardId: "9-hearts" });
  });

  it("asks again before discarding a wild", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, readyToDiscard({ hand: [card("JOKER", null), card("9", "hearts")] }));
    choose("Joker, wild", /^discard$/i);
    const confirm = screen.getByRole("dialog", { name: /confirm discard/i });
    expect(confirm.textContent).toMatch(/wild card/i);
    expect(sent).toEqual([]);
    fireEvent.click(within(confirm).getByRole("button", { name: /discard anyway/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args[0]).toEqual({ type: "discard", cardId: "JOKER-null" });
  });

  it("asks again before discarding a card that could go on one of your melds", () => {
    const { socket, sent } = fakeSocket();
    mount(
      socket,
      readyToDiscard({
        isDown: true,
        melds: [
          { rank: "9", cards: [card("9", "clubs"), card("9", "spades"), card("9", "diamonds")] },
        ],
      }),
    );
    choose("Nine of hearts", /^discard$/i);
    expect(screen.getByRole("dialog").textContent).toMatch(/meld of 9s/i);
    fireEvent.click(screen.getByRole("button", { name: /keep it/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("does not ask about an ordinary card", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, readyToDiscard());
    choose("King of spades", /^discard$/i);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("is blocked while melds are staged", () => {
    // Playing them is a separate action; discarding first would throw the staged
    // lay-down away without saying so.
    mount(fakeSocket().socket, readyToDiscard());
    meld("King of spades");
    // With a lay-down under way a click stages, so no discard is on offer at all.
    fireEvent.click(handCard("Nine of hearts"));
    expect(screen.queryByRole("menuitem", { name: "Discard" })).toBeNull();
    expect(screen.getByText(/click cards to add them/i)).toBeInTheDocument();
  });

  it("offers nothing to click during the draw phase", () => {
    mount(fakeSocket().socket);
    expect(screen.queryByRole("button", { name: "Ace of spades" })).toBeNull();
    expect(screen.getByText(/click the stock to draw/i)).toBeInTheDocument();
  });
});

describe("marking your hand", () => {
  it("underlines cards of a rank you already have a meld of", () => {
    mount(
      fakeSocket().socket,
      update({
        view: {
          isDown: true,
          hand: [card("9", "hearts"), card("K", "spades")],
          melds: [
            { rank: "9", cards: [card("9", "clubs"), card("9", "spades"), card("9", "diamonds")] },
          ],
        },
      }),
    );
    const hand = screen.getByRole("region", { name: /your hand/i });
    expect(within(hand).getByTitle(/you have a meld of 9s/i)).toBeInTheDocument();
    expect(within(hand).queryByTitle(/meld of Ks/i)).toBeNull();
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

  it("closes an open card menu when the turn passes", () => {
    mount(fakeSocket().socket, playing(hand));
    fireEvent.click(handCard("Four of spades"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    deliver(passed(hand.filter((c) => c.id !== "4-spades")));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("drops a staged lay-down when the turn passes", () => {
    mount(fakeSocket().socket, playing(hand));
    meld("King of clubs");
    expect(screen.getByLabelText(/lay-down being built/i)).toBeInTheDocument();

    deliver(passed(hand));
    deliver(playing(hand));
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
  });

  it("closes the menu, and takes the cards out of reach, when the round ends", () => {
    mount(fakeSocket().socket, playing(hand));
    fireEvent.click(handCard("Nine of hearts"));
    act(() => useSession.setState({ result: scored([], 1) }));
    expect(screen.queryByRole("menu")).toBeNull();
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
    for (const suit of ["clubs", "hearts", "spades", "diamonds"]) meld(`King of ${suit}`);

    deliver(down(kings.slice(0, 3)));
    fireEvent.click(screen.getByRole("button", { name: /play these melds/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const action = sent[0].args[0] as { melds: { rank: string; cardIds: string[] }[] };
    expect(action.melds).toEqual([{ rank: "K", cardIds: ["K-clubs", "K-hearts", "K-spades"] }]);
  });

  it("sends exactly one discard for two quick clicks", async () => {
    const { socket, sent, release } = heldSocket();
    mount(socket, playing(hand));
    choose("Four of spades", /^discard$/i);
    // The first is still in flight: its Discard is disabled, and a second card
    // cannot open a menu of its own.
    expect(screen.getByRole("menuitem", { name: "Discard" })).toBeDisabled();
    fireEvent.click(handCard("Nine of hearts"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(handCard("Nine of hearts")).toHaveAttribute("aria-pressed", "false");
    await act(async () => release());
    expect(sent.filter((s) => s.event === "submitAction")).toHaveLength(1);
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

  it("says who paused, when the table will close, and offers a resume", async () => {
    const closesAt = new Date(2026, 8, 29, 15, 45).getTime();
    const { socket, sent } = fakeSocket();
    mount(
      socket,
      update({
        clock: { serverNow: Date.now(), paused: true, deadlineAt: null },
        room: { pausedBy: 1, closesAt },
      }),
    );
    const bar = screen.getByRole("status", { name: "Paused" });
    expect(bar.textContent).toMatch(
      /ben paused the table\. It closes at 3:45\sPM unless someone resumes it\./,
    );
    // One way to resume, not two.
    expect(screen.getAllByRole("button", { name: "Resume" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^pause$/i })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ event: "setPaused", args: [{ paused: false }] });
  });

  it("gives the closing time by this browser's clock, not the server's", () => {
    // The server runs ten minutes ahead: its 3:55 is 3:45 here.
    const skew = 10 * 60_000;
    const closesAt = new Date(2026, 8, 29, 15, 45, 30).getTime() + skew;
    mount(
      fakeSocket().socket,
      update({
        clock: { serverNow: Date.now() + skew, paused: true, deadlineAt: null },
        room: { pausedBy: 1, closesAt },
      }),
    );
    expect(screen.getByRole("status", { name: "Paused" }).textContent).toMatch(
      /It closes at 3:45\sPM unless someone resumes it\./,
    );
  });

  it("offers to save a paused family game for later, and says until when once saved", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, update({ clock: { paused: true, deadlineAt: null }, room: { pausedBy: 0 } }));
    fireEvent.click(screen.getByRole("button", { name: "Save for later" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ event: "saveForLater", args: [] });
  });

  it("shows a saved game's date, and offers no second save", () => {
    const savedUntil = new Date(2026, 9, 6, 12, 0).getTime();
    mount(
      fakeSocket().socket,
      update({
        clock: { serverNow: Date.now(), paused: true, deadlineAt: null },
        room: { pausedBy: 0, savedUntil, closesAt: savedUntil },
      }),
    );
    expect(screen.getByRole("status", { name: "Paused" }).textContent).toMatch(
      /Saved for later until Tue, Oct 6\./,
    );
    expect(screen.queryByRole("button", { name: "Save for later" })).toBeNull();
  });

  it("explains a table that paused itself, and lets a competitive table resume it", async () => {
    const { socket, sent } = fakeSocket();
    mount(
      socket,
      update({
        clock: { paused: true, deadlineAt: null },
        room: {
          idlePaused: true,
          config: { ...EAST_COAST, mode: "competitive", pauseEnabled: false },
        },
      }),
    );
    const bar = screen.getByRole("status", { name: "Paused" });
    expect(bar.textContent).toMatch(/Paused because nobody has played for a full lap\./);
    // Saving is a family-game thing.
    expect(within(bar).queryByRole("button", { name: "Save for later" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(sent[0]).toEqual({ event: "setPaused", args: [{ paused: false }] }));
  });

  it("shows no pause bar while the table is playing", () => {
    mount(fakeSocket().socket);
    expect(screen.queryByRole("status", { name: "Paused" })).toBeNull();
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

  it("makes each meld down selectable", () => {
    mount(fakeSocket().socket, alreadyDown());
    expect(screen.getByRole("button", { name: /select meld of Ks/i })).toBeInTheDocument();
  });

  it("lets a wild be aimed at that book with no natural to open a group", () => {
    // The case that needs the affordance: there is no king left in hand to start a
    // group, so without focusing the rank the wild would have nowhere to go.
    const { socket, sent } = fakeSocket();
    mount(socket, alreadyDown());
    fireEvent.click(screen.getByRole("button", { name: /select meld of Ks/i }));
    expect(screen.getByRole("button", { name: /select meld of Ks/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(handCard("Two of clubs, wild"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to Ks" }));

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
    meld("Nine of hearts");
    const nines = screen.getByRole("button", { name: "Select the 9s meld" });
    const kings = screen.getByRole("button", { name: /select meld of Ks/i });
    expect(nines).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(kings);
    expect(kings).toHaveAttribute("aria-pressed", "true");
    expect(nines).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no way in before the player is down", () => {
    // There are no books to add to yet, so the affordance would be meaningless.
    mount(
      fakeSocket().socket,
      update({ view: { phase: "play" }, hints: { phase: "play", canDraw: false } }),
    );
    expect(screen.queryByRole("button", { name: /select meld/i })).toBeNull();
  });
});

describe("the controls added from play-testing", () => {
  const nines = [card("9", "clubs"), card("9", "spades"), card("9", "diamonds")];
  function down(
    hand: Card[],
    over: Partial<PlayerView> = {},
    hints: Partial<LegalHints> = {},
  ): ViewUpdate {
    return update({
      view: { hand, phase: "play", isDown: true, melds: [{ rank: "9", cards: nines }], ...over },
      hints: { phase: "play", canDraw: false, ...hints },
    });
  }

  it("enters meld mode from a button, without picking a card first", () => {
    mount(
      fakeSocket().socket,
      down([card("K", "clubs"), card("K", "hearts"), card("K", "spades")]),
    );
    fireEvent.click(screen.getByRole("button", { name: /^meld$/i }));
    expect(screen.getByLabelText(/lay-down being built/i).textContent).toMatch(/click cards/i);
    fireEvent.click(handCard("King of clubs"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByLabelText(/lay-down being built/i)).toHaveTextContent(/1 total/);
    fireEvent.click(screen.getByRole("button", { name: /stop melding/i }));
    expect(screen.queryByLabelText(/lay-down being built/i)).toBeNull();
  });

  it("sends a card of a melded rank straight onto its meld from the card's menu", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, down([card("9", "hearts"), card("K", "spades")]));
    choose("Nine of hearts", /add to 9s meld/i);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args[0]).toEqual({
      type: "playMelds",
      melds: [{ rank: "9", cardIds: ["9-hearts"] }],
    });
  });

  it("adds every natural it can to the melds already down, and never a wild", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, down([card("9", "hearts"), card("2", "clubs"), card("K", "spades")]));
    fireEvent.click(screen.getByRole("button", { name: /add 1 to my melds/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args[0]).toEqual({
      type: "playMelds",
      melds: [{ rank: "9", cardIds: ["9-hearts"] }],
    });
  });

  it("plays the last card of the foot straight away, with nothing to confirm", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, down([], { inFoot: true, foot: [card("9", "hearts")], hand: [] }));
    fireEvent.click(screen.getByRole("button", { name: /add 1 to my melds/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args[0]).toEqual({
      type: "playMelds",
      melds: [{ rank: "9", cardIds: ["9-hearts"] }],
    });
    expect(screen.queryByRole("button", { name: /keep it/i })).toBeNull();
  });

  it("shows the auto-add for a single card of a melded rank in the hand", () => {
    mount(fakeSocket().socket, down([card("9", "hearts")]));
    expect(screen.getByRole("button", { name: /add 1 to my melds/i })).toBeInTheDocument();
  });

  it("puts Play melds beside Stop melding, above the hand", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, down([card("K", "clubs"), card("K", "hearts"), card("K", "spades")]));
    fireEvent.click(screen.getByRole("button", { name: /^meld$/i }));
    const bar = screen.getByRole("region", { name: /your turn/i });
    const play = within(bar).getByRole("button", { name: /^play melds$/i });
    expect(play).toBeDisabled();
    expect(within(bar).getByRole("button", { name: /stop melding/i })).toBeInTheDocument();
    for (const suit of ["clubs", "hearts", "spades"]) fireEvent.click(handCard(`King of ${suit}`));
    fireEvent.click(play);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0].args[0] as { type: string }).type).toBe("playMelds");
  });

  it("offers no auto-add before the player is down", () => {
    mount(
      fakeSocket().socket,
      update({
        view: { phase: "play", hand: [card("9", "hearts")] },
        hints: { phase: "play", canDraw: false },
      }),
    );
    expect(screen.queryByRole("button", { name: /to my melds/i })).toBeNull();
  });

  it("draws by clicking the stock and takes the pile by clicking it", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, update({ hints: { canTakePile: true } }));
    fireEvent.click(screen.getByRole("button", { name: /draw a card \(40 left\)/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /take the pile/i }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.args[0])).toEqual([{ type: "draw" }, { type: "takePile" }]);
  });

  it("labels the piles with what clicking them does, while they can be clicked", () => {
    mount(fakeSocket().socket, update({ hints: { canTakePile: true } }));
    expect(screen.getByText("Draw a card")).toBeInTheDocument();
    expect(screen.getByText("Pick up the pile")).toBeInTheDocument();
  });

  it("pulses the piles and their labels in step", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_250);
    try {
      mount(fakeSocket().socket, update({ hints: { canTakePile: true } }));
      // 10 250 ms is 450 ms into a 1 400 ms cycle, so each starts 450 ms in.
      const delays = [
        screen.getByRole("button", { name: /draw a card/i }),
        screen.getByRole("button", { name: /take the pile/i }),
        screen.getByText("Draw a card"),
        screen.getByText("Pick up the pile"),
      ].map((el) => el.style.animationDelay);
      expect(delays).toEqual(["-450ms", "-450ms", "-450ms", "-450ms"]);
    } finally {
      now.mockRestore();
    }
  });

  it("sets a pile's phase when it becomes clickable, not when it first appeared", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_250);
    try {
      mount(fakeSocket().socket, update({ hints: { canDraw: false, phase: "play" } }));
      now.mockReturnValue(11_000);
      act(() => useSession.getState().applyUpdate(update({ hints: { canTakePile: true } })));
      // 11 000 is 1 200 ms into the cycle: in step with a pulse started at any time.
      expect(screen.getByRole("button", { name: /take the pile/i }).style.animationDelay).toBe(
        "-1200ms",
      );
      expect(screen.getByRole("button", { name: /draw a card/i }).style.animationDelay).toBe(
        "-1200ms",
      );
    } finally {
      now.mockRestore();
    }
  });

  it("drops the labels once the draw is done", () => {
    mount(fakeSocket().socket, update({ hints: { canDraw: false, phase: "play" } }));
    expect(screen.queryByText("Draw a card")).toBeNull();
    expect(screen.queryByText("Pick up the pile")).toBeNull();
  });

  it("goes to the main menu without giving up the seat", () => {
    mount(fakeSocket().socket);
    fireEvent.click(screen.getByRole("button", { name: /main menu/i }));
    expect(screen.getByText("main screen")).toBeInTheDocument();
    expect(useSession.getState().credentials?.roomId).toBe("ABC234");
  });

  it("inks a clean book's top card red and a dirty book's black", () => {
    const clubs = (rank: Rank, i: number): Card => ({ id: `${rank}c${i}`, rank, suit: "clubs" });
    const clean = [...Array.from({ length: 6 }, (_, i) => clubs("9", i)), card("9", "hearts")];
    const dirty = [...Array.from({ length: 6 }, (_, i) => clubs("K", i)), card("JOKER", null)];
    mount(
      fakeSocket().socket,
      update({
        view: {
          isDown: true,
          melds: [
            { rank: "9", cards: clean },
            { rank: "K", cards: dirty },
          ],
        },
      }),
    );
    const ink = (name: RegExp): string | null =>
      screen.getByRole("img", { name }).querySelector("text")!.getAttribute("fill");
    expect(ink(/clean book of 9s/)).toBe("#dc2626");
    expect(ink(/dirty book of Ks/)).toBe("#0f172a");
  });

  it("darkens black threes in the hand, and offers no meld for them", () => {
    mount(
      fakeSocket().socket,
      update({
        view: { hand: [card("3", "clubs"), card("K", "spades")], phase: "play" },
        hints: { phase: "play", canDraw: false },
      }),
    );
    const three = handCard("Three of clubs, blocks the pile");
    expect(three.className).toMatch(/opacity-60/);
    expect(handCard("King of spades").className).not.toMatch(/opacity-60/);
    fireEvent.click(three);
    expect(screen.queryByRole("menuitem", { name: /meld/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Discard" })).toBeInTheDocument();
  });

  it("lights black threes up in the foot once there are seven to book", () => {
    const threes = Array.from({ length: 7 }, (_, i) => ({
      id: `b3-${i}`,
      rank: "3" as Rank,
      suit: "spades" as Suit,
    }));
    mount(
      fakeSocket().socket,
      update({
        view: { hand: [], inFoot: true, foot: threes, phase: "play" },
        hints: { phase: "play", canDraw: false },
      }),
    );
    const buttons = within(screen.getByRole("region", { name: /your foot/i })).getAllByRole(
      "button",
    );
    expect(buttons.every((b) => !/opacity-60/.test(b.className))).toBe(true);
    fireEvent.click(buttons[0]!);
    expect(screen.getByRole("menuitem", { name: "Meld" })).toBeInTheDocument();
  });

  it("lights up a black three in the foot that can join the black-three book already down", async () => {
    const book = Array.from({ length: 7 }, (_, i) => ({
      id: `m3-${i}`,
      rank: "3" as Rank,
      suit: "clubs" as Suit,
    }));
    const { socket, sent } = fakeSocket();
    mount(
      socket,
      update({
        view: {
          hand: [],
          inFoot: true,
          isDown: true,
          foot: [card("3", "spades"), card("K", "spades")],
          melds: [{ rank: "3", cards: book }],
          phase: "play",
        },
        hints: { phase: "play", canDraw: false },
      }),
    );
    expect(handCard("Three of spades, blocks the pile").className).not.toMatch(/opacity-60/);
    // And the auto-add picks it up with the rest.
    fireEvent.click(screen.getByRole("button", { name: /add 1 to my melds/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args[0]).toEqual({
      type: "playMelds",
      melds: [{ rank: "3", cardIds: ["3-spades"] }],
    });
  });

  it("keeps the unpicked foot beside the hand", () => {
    mount(fakeSocket().socket);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("img", { name: "Your foot: 14" })).toBeInTheDocument();
    expect(within(footer).getByRole("region", { name: /your hand/i })).toBeInTheDocument();
  });

  it("shows each opponent's hand as cards, and their foot as a stack", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("img", { name: "Hand: 11" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Foot: 14" })).toBeInTheDocument();
  });

  it("announces a go-out and a final lap loudly, and tells the player it is their last turn", () => {
    mount(fakeSocket().socket, update({ view: { wentOutSeat: 1, finalLapRemaining: 1 } }));
    expect(screen.getByRole("status")).toHaveTextContent("ben went out! This is your last turn.");
  });

  it("keeps the next-game choices on screen with the scores hidden", async () => {
    const { socket, sent } = fakeSocket([{ ok: false, error: "nope" }]);
    mount(socket);
    act(() => useSession.setState({ result: scored([[0, 10]], 0) }));
    fireEvent.click(screen.getByRole("button", { name: /look at the table/i }));
    const bar = screen.getByRole("region", { name: /round over/i });
    expect(
      within(bar).getByRole("button", { name: /back to the main screen/i }),
    ).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: /^play again$/i }));
    await waitFor(() => expect(sent).toEqual([{ event: "playAgain", args: [] }]));
  });

  it("can be dragged out of the way by its title bar", () => {
    mount(fakeSocket().socket);
    act(() => useSession.setState({ result: scored([[0, 10]], 0) }));
    const dialog = screen.getByRole("dialog", { name: /round result/i });
    const handle = screen.getByLabelText(/drag to move the scores/i);
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 160, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(dialog.style.transform).toBe("translate(60px, -60px)");
    // Moving without a press does nothing.
    fireEvent.pointerMove(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(dialog.style.transform).toBe("translate(60px, -60px)");
  });

  it("puts the round result over the table, headed by who went out, and can hide it", () => {
    mount(fakeSocket().socket);
    act(() =>
      useSession.setState({
        result: scored(
          [
            [0, 10],
            [1, 5],
          ],
          1,
          { matchOver: false, roundNumber: 1 },
        ),
      }),
    );
    const dialog = screen.getByRole("dialog", { name: /round result/i });
    expect(dialog).toHaveTextContent("ben went out!");
    fireEvent.click(within(dialog).getByRole("button", { name: /look at the table/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show the scores/i }));
    expect(screen.getByRole("dialog", { name: /round result/i })).toBeInTheDocument();
  });

  it("lets a player leave the finished table for the main screen", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    act(() => useSession.setState({ result: scored([[0, 10]], 0) }));
    fireEvent.click(screen.getByRole("button", { name: /back to the main screen/i }));
    await waitFor(() => expect(screen.getByText("main screen")).toBeInTheDocument());
    expect(sent).toEqual([{ event: "leaveRoom", args: [] }]);
    expect(useSession.getState().credentials).toBeNull();
  });

  it("goes to the next game's waiting room, forgetting the old table", async () => {
    const next = { roomId: "NEXT23", seat: 0, token: "t-next" };
    const { socket, sent } = fakeSocket([{ ok: true, data: next }]);
    mount(socket);
    act(() => useSession.setState({ result: scored([[0, 10]], 0) }));
    fireEvent.click(screen.getByRole("button", { name: /^play again$/i }));
    await waitFor(() => expect(useSession.getState().credentials).toEqual(next));
    expect(sent).toEqual([{ event: "playAgain", args: [] }]);
    expect(useSession.getState().result).toBeNull();
    expect(useSession.getState().update).toBeNull();
  });

  it("stays put and says why when the next game started without them", async () => {
    const { socket } = fakeSocket([
      { ok: false, error: "the next game has already started without you" },
    ]);
    mount(socket);
    act(() => useSession.setState({ result: scored([[0, 10]], 0) }));
    fireEvent.click(screen.getByRole("button", { name: /^play again$/i }));
    const dialog = screen.getByRole("dialog", { name: /round result/i });
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(/started without you/),
    );
    expect(useSession.getState().credentials?.roomId).toBe("ABC234");
  });

  it("shows who is already waiting in the next game", () => {
    mount(fakeSocket().socket);
    act(() =>
      useSession.setState({
        result: scored(
          [
            [0, 10],
            [1, 5],
          ],
          0,
        ),
      }),
    );
    act(() => useSession.getState().applyRoom(roomInfo({ playAgain: [1] })));
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
      "Waiting in the next game: ben (1 of 2)",
    );
  });

  it("says when the stock ran out rather than naming anyone", () => {
    mount(fakeSocket().socket);
    act(() =>
      useSession.setState({
        result: scored([[0, 10]], undefined, { matchOver: false, roundNumber: 1 }),
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("The stock ran out.");
  });

  it("keeps a book's size under it, like any meld", () => {
    const sevenAces = Array.from({ length: 7 }, (_, i) => ({
      id: `a${i}`,
      rank: "A" as Rank,
      suit: "spades" as Suit,
    }));
    mount(
      fakeSocket().socket,
      update({ view: { isDown: true, melds: [{ rank: "A", cards: sevenAces }] } }),
    );
    expect(
      within(screen.getByLabelText(/your melds/i)).getByText(/7 cards · clean/),
    ).toBeInTheDocument();
  });
});

describe("a match of several rounds", () => {
  it("says which round of how many, and the scores so far once past the first", () => {
    mount(fakeSocket().socket, update({ view: { roundNumber: 2, scoresSoFar: [450, 120] } }));
    expect(screen.getByText(/round 2 of 4 · minimum 90/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scores so far/i)).toHaveTextContent("ana 450 · ben 120");
  });

  it("shows no running scores in the first round", () => {
    mount(fakeSocket().socket);
    expect(screen.getByText(/round 1 of 4 · minimum 60/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/scores so far/i)).toBeNull();
  });

  it("offers the next round, not a new game, while the match goes on", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: false }]);
    mount(socket);
    act(() =>
      useSession.setState({
        result: scored(
          [
            [0, 300],
            [1, 500],
          ],
          1,
          { matchOver: false, roundNumber: 1, totals: [300, 500] },
        ),
      }),
    );
    const dialog = screen.getByRole("dialog", { name: /round result/i });
    expect(dialog).toHaveTextContent("Round 1 of 4 over");
    expect(within(dialog).queryByRole("button", { name: /^play again$/i })).toBeNull();
    // Ranked by the match so far: ben leads.
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveAccessibleName(/^ben/);
    fireEvent.click(within(dialog).getByRole("button", { name: /^next round$/i }));
    await waitFor(() => expect(sent).toEqual([{ event: "nextRound", args: [] }]));

    act(() => useSession.getState().applyRoom(roomInfo({ nextRoundReady: [0] })));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Ready for round 2: ana (1 of 2)");
    expect(within(dialog).getByRole("button", { name: /waiting for the others/i })).toBeDisabled();
  });

  it("names the winner at the end of the match, with the final totals", () => {
    mount(fakeSocket().socket);
    act(() =>
      useSession.setState({
        result: scored(
          [
            [0, 40],
            [1, 90],
          ],
          0,
          { matchOver: true, roundNumber: 4, totals: [2400, 1800] },
        ),
      }),
    );
    const dialog = screen.getByRole("dialog", { name: /round result/i });
    expect(dialog).toHaveTextContent("ana wins!");
    expect(dialog).toHaveTextContent("Final scores after 4 rounds");
    expect(within(dialog).getByRole("row", { name: /^ana/ })).toHaveTextContent("2400");
    expect(within(dialog).getByRole("button", { name: /^play again$/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /next round/i })).toBeNull();
  });

  it("calls a tie a tie", () => {
    mount(fakeSocket().socket);
    act(() =>
      useSession.setState({
        result: scored(
          [
            [0, 40],
            [1, 90],
          ],
          0,
          { matchOver: true, totals: [2000, 2000] },
        ),
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("A tie between ana and ben!");
  });

  it("clears the last round's scores when the next one is dealt", () => {
    mount(fakeSocket().socket);
    act(() =>
      useSession.setState({ result: scored([[0, 10]], 0, { matchOver: false, roundNumber: 1 }) }),
    );
    act(() => useSession.getState().applyUpdate(update({ view: { roundNumber: 2 } })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("on a phone", () => {
  /** Answer the phone query as a phone would, for the length of one test. */
  function asPhone(): void {
    const listeners = new Set<() => void>();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === PHONE_QUERY,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      }),
    });
    // And as wide as a phone, which the hand's rows are sized to.
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  }

  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    window.localStorage.removeItem("hf.compactMelds");
  });

  const kings = {
    rank: "K" as const,
    cards: ["hearts", "spades", "diamonds", "clubs", "hearts", "spades", "diamonds"].map(
      (s, i) => ({
        id: `K-${s}-${i}`,
        rank: "K" as const,
        suit: s as Suit,
      }),
    ),
  };

  it("shows each opponent as a chip, with their melds a tap away", () => {
    asPhone();
    mount(
      fakeSocket().socket,
      update({
        view: {
          opponents: [
            { seat: 1, handCount: 0, footCount: 9, melds: [kings], isDown: true, inFoot: true },
          ],
        },
      }),
    );
    const chip = screen.getByRole("button", {
      name: "ben, 9 in foot, playing from it, 1 book, 1 clean",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(chip);
    const sheet = screen.getByRole("dialog", { name: "ben's melds" });
    expect(sheet.textContent).toMatch(/Playing from the foot, 9 cards left\./);
    expect(
      within(sheet).getByRole("listitem", { name: "clean book of Ks, 7 cards" }),
    ).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the melds sheet, and closes it on Escape", () => {
    asPhone();
    mount(fakeSocket().socket);
    fireEvent.click(screen.getByRole("button", { name: /^ben,/ }));
    const sheet = screen.getByRole("dialog", { name: "ben's melds" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(within(sheet).getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a card's actions in a sheet over the table, which a tap outside closes", () => {
    asPhone();
    const ranks: Rank[] = ["4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    mount(
      fakeSocket().socket,
      update({
        view: { phase: "play", hand: ranks.map((rank) => card(rank, "hearts")) },
        hints: { phase: "play", canDraw: false },
      }),
    );
    const four = handCard("Four of hearts");
    fireEvent.click(four);
    const sheet = screen.getByRole("group", { name: "Actions for Four of hearts" });
    // Fixed over the screen, not inside the hand's scrolling footer, so nothing clips it.
    expect(sheet.parentElement).toHaveClass("fixed");
    expect(sheet.closest("footer")).toBeNull();
    expect(within(sheet).getByRole("menu", { name: "Card actions" })).toBeInTheDocument();
    expect(four).toHaveAttribute("aria-pressed", "true");
    // A tap inside the sheet leaves it open; a tap on the table around it closes it.
    fireEvent.click(sheet);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(sheet.parentElement!);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(four).toHaveAttribute("aria-pressed", "false");
  });

  it("says who has not gone down, and who is on turn", () => {
    asPhone();
    mount(fakeSocket().socket, update({ hints: { seatToAct: 1 }, view: { currentSeat: 1 } }));
    expect(
      screen.getByRole("button", { name: "ben, 11 in hand, not down, to play" }),
    ).toBeInTheDocument();
  });

  it("shows the player's melds as chips that still aim a wild", () => {
    asPhone();
    const { socket } = fakeSocket();
    mount(
      socket,
      update({
        view: { melds: [kings], isDown: true, phase: "play", hand: [card("2", "clubs")] },
        hints: { phase: "play", canDraw: false },
      }),
    );
    // Cards by default, as on the desktop; chips once the player collapses them.
    expect(
      screen.getByRole("button", { name: "Select clean book of Ks, 7 cards" }).textContent,
    ).toMatch(/7 cards · clean/);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    const chip = screen.getByRole("button", { name: "Select clean book of Ks, 7 cards" });
    expect(chip.textContent).toBe("K×7");
    expect(screen.getByRole("button", { name: "Show cards" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the header's buttons named for what they do, drawn as icons", () => {
    asPhone();
    mount(fakeSocket().socket);
    expect(screen.getByRole("button", { name: "Pause" }).textContent).toBe("");
    expect(screen.getByRole("button", { name: "Main menu" }).textContent).toBe("☰");
    expect(screen.getByText(/Tap the stock to draw/)).toBeInTheDocument();
  });
});

describe("laying a hand out in rows", () => {
  it("fits as many whole cards as the hand's measured width holds, gaps included", () => {
    // Exactly six cards and their gaps are 356 wide; a pixel less fits five.
    expect(perRow(356)).toBe(6);
    expect(perRow(355)).toBe(5);
    // A phone's hand uses 46-wide cards: a 390 phone's hand, beside the foot pile,
    // is about 326 wide, which holds six.
    expect(perRow(326, 46)).toBe(6);
    expect(perRow(100)).toBe(3);
  });

  it("splits into rows of even length, so no card is left alone at the end", () => {
    const sizes = (n: number) => evenRows([...Array(n).keys()], 6).map((row) => row.length);
    expect(sizes(0)).toEqual([]);
    expect(sizes(6)).toEqual([6]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(14)).toEqual([5, 5, 4]);
    expect(sizes(15)).toEqual([5, 5, 5]);
  });

  it("sizes the rows to the room the hand is given, and follows it as it changes", () => {
    const observers: { fire: (width: number) => void }[] = [];
    const Real = globalThis.ResizeObserver;
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 330 } as DOMRect);
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {
        observers.push({
          fire: (width) =>
            this.callback(
              [{ contentRect: { width } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            ),
        });
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    try {
      // A 390-wide window, but the foot and the padding leave the hand 330.
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
      const ranks = ["4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "4"] as const;
      const hand = ranks.map((rank, i) => card(rank, i % 2 ? "hearts" : "spades"));
      render(
        <Hand
          cards={hand}
          interactive={false}
          stagedIds={new Set()}
          owedIds={new Set()}
          meldRanks={new Set()}
          playContext={{ inFoot: false, blackThreesHeld: 0, hasBlackThreeMeld: false }}
          onSelect={() => {}}
          chosenId={null}
          menu={null}
          title="Your hand"
          rows
        />,
      );
      const rowSizes = () =>
        [...screen.getByRole("region", { name: "Your hand" }).querySelector(".pt-3")!.children].map(
          (row) => within(row as HTMLElement).getAllByRole("img").length,
        );
      // 330 holds six of a phone's 46-wide cards with their gaps.
      expect(rowSizes()).toEqual([6, 6]);
      act(() => observers.at(-1)!.fire(1_000));
      expect(rowSizes()).toEqual([12]);
    } finally {
      measure.mockRestore();
      globalThis.ResizeObserver = Real;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    }
  });
});

describe("taking back this turn's melds", () => {
  const kings = [card("K", "hearts"), card("K", "spades"), card("K", "clubs")];
  const wild = card("2", "hearts");
  function played(): ViewUpdate {
    return update({
      view: {
        phase: "play",
        isDown: true,
        hand: [card("5", "spades")],
        melds: [{ rank: "K", cards: [...kings, wild] }],
        playedThisTurn: [...kings, wild].map((c) => c.id),
      },
      hints: { phase: "play", canDraw: false },
    });
  }

  it("marks what was played this turn as not yet final", () => {
    mount(fakeSocket().socket, played());
    const meld = screen.getByRole("listitem", { name: "Meld of Ks, 4 cards" });
    expect(meld.textContent).toMatch(/this turn/);
  });

  it("puts the played cards back into the lay-down being built, grouped as played", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: undefined }]);
    mount(socket, played());
    fireEvent.click(screen.getByRole("button", { name: "Take back melds" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ event: "submitAction", args: [{ type: "takeBack" }] });
    // The server's answer: the cards are back in hand, the meld gone.
    act(() =>
      useSession.getState().applyUpdate(
        update({
          view: { phase: "play", isDown: false, hand: [card("5", "spades"), ...kings, wild] },
          hints: { phase: "play", canDraw: false },
        }),
      ),
    );
    const panel = await screen.findByLabelText(/lay-down being built/i);
    for (const name of [
      "King of hearts",
      "King of spades",
      "King of clubs",
      "Two of hearts, wild",
    ]) {
      expect(within(panel).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("is not offered with nothing played this turn", () => {
    mount(fakeSocket().socket, update({ view: { phase: "play" }, hints: { phase: "play" } }));
    expect(screen.queryByRole("button", { name: "Take back melds" })).toBeNull();
  });
});

describe("what just happened", () => {
  it("marks the card this player just drew, for the rest of the turn", () => {
    const drawn = card("Q", "diamonds");
    mount(
      fakeSocket().socket,
      update({
        view: { phase: "play", hand: [card("A", "spades"), drawn] },
        hints: { phase: "play", canDraw: false },
        lastMove: { seq: 4, seat: 0, kind: "draw", card: drawn },
      }),
    );
    expect(screen.getByText("NEW")).toBeInTheDocument();
    // The turn passes: the mark goes.
    act(() =>
      useSession
        .getState()
        .applyUpdate(update({ hints: { seatToAct: 1 }, view: { currentSeat: 1 } })),
    );
    expect(screen.queryByText("NEW")).toBeNull();
  });

  it("announces another player's discard with the card, then lets it go", async () => {
    vi.useFakeTimers();
    try {
      mount(fakeSocket().socket, update({ lastMove: { seq: 1, seat: 1, kind: "draw" } }));
      // Nothing is announced for what had already happened when the page opened.
      expect(screen.queryByRole("status", { name: "Latest move" })).toBeNull();
      const seven = card("7", "hearts");
      act(() =>
        useSession.getState().applyUpdate(
          update({
            view: { discard: [seven] },
            lastMove: { seq: 2, seat: 1, kind: "discard", card: seven },
          }),
        ),
      );
      const news = screen.getByRole("status", { name: "Latest move" });
      expect(news.textContent).toMatch(/ben discarded a 7$/);
      expect(within(news).getByRole("img", { name: "Seven of hearts" })).toBeInTheDocument();
      // A room broadcast in the meantime does not keep it up, or bring it back.
      act(() =>
        useSession.getState().applyUpdate(
          update({
            view: { discard: [seven] },
            lastMove: { seq: 2, seat: 1, kind: "discard", card: seven },
          }),
        ),
      );
      act(() => vi.advanceTimersByTime(3_500));
      expect(screen.queryByRole("status", { name: "Latest move" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces another player picking up the pile, but not this player's own moves", () => {
    mount(fakeSocket().socket, update({ lastMove: { seq: 1, seat: 0, kind: "draw" } }));
    act(() =>
      useSession
        .getState()
        .applyUpdate(
          update({ lastMove: { seq: 2, seat: 0, kind: "discard", card: card("4", "clubs") } }),
        ),
    );
    expect(screen.queryByRole("status", { name: "Latest move" })).toBeNull();
    act(() =>
      useSession
        .getState()
        .applyUpdate(update({ lastMove: { seq: 3, seat: 1, kind: "takePile", count: 12 } })),
    );
    expect(screen.getByRole("status", { name: "Latest move" }).textContent).toBe(
      "ben picked up the pile (12 cards)",
    );
  });
});

describe("sound", () => {
  /** An audio device that counts what it is asked to play. */
  function fakeAudio(): { oscillators: number; noises: number; restore: () => void } {
    const counts = { oscillators: 0, noises: 0 };
    const node = () => ({
      connect: (n: unknown) => n,
      gain: {
        value: 0,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
    });
    class FakeContext {
      currentTime = 0;
      sampleRate = 8_000;
      destination = {};
      resume = () => Promise.resolve();
      createGain = node;
      createBiquadFilter = () => ({
        ...node(),
        type: "",
        frequency: { value: 0 },
        Q: { value: 0 },
      });
      createBuffer = (_: number, length: number) => ({
        getChannelData: () => new Float32Array(length),
      });
      createBufferSource = () => {
        counts.noises++;
        return { ...node(), buffer: null, start() {} };
      };
      createOscillator = () => {
        counts.oscillators++;
        return { ...node(), type: "", frequency: { value: 0 }, start() {}, stop() {} };
      };
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
    return Object.assign(counts, {
      restore: () => delete (window as { AudioContext?: unknown }).AudioContext,
    });
  }

  afterEach(() => window.localStorage.removeItem("hf.muted"));

  it("chimes when the turn comes round, once the player has touched the page", () => {
    const audio = fakeAudio();
    try {
      mount(fakeSocket().socket, update({ hints: { seatToAct: 1 }, view: { currentSeat: 1 } }));
      fireEvent.pointerDown(window);
      act(() => useSession.getState().applyUpdate(update()));
      expect(audio.oscillators).toBe(2);
    } finally {
      audio.restore();
    }
  });

  it("stays silent when muted, and remembers the choice", () => {
    const audio = fakeAudio();
    try {
      mount(fakeSocket().socket, update({ hints: { seatToAct: 1 }, view: { currentSeat: 1 } }));
      fireEvent.pointerDown(window);
      const toggle = screen.getByRole("button", { name: "Turn sound off" });
      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Turn sound on" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(window.localStorage.getItem("hf.muted")).toBe("1");
      act(() =>
        useSession
          .getState()
          .applyUpdate(
            update({ lastMove: { seq: 3, seat: 1, kind: "discard", card: card("4", "clubs") } }),
          ),
      );
      expect(audio.oscillators + audio.noises).toBe(0);
    } finally {
      audio.restore();
    }
  });
});
