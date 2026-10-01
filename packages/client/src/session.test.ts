import { describe, it, expect, beforeEach, vi } from "vitest";
import { EAST_COAST, type RoomInfo, type RoundEnded, type ViewUpdate } from "@hf/shared";
import { clearCredentials, loadCredentials } from "./credentials";
import { createServerClock } from "./serverTime";
import {
  KEPT_REACTIONS,
  attachSession,
  useSession,
  type SessionSink,
  type SessionSocket,
} from "./session";

const NO_BREAKDOWN = {
  cleanBooks: 0,
  dirtyBooks: 0,
  bookBonus: 0,
  meldedCards: 100,
  goOutBonus: 0,
  heldCount: 0,
  heldPenalty: 0,
};

function roomInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    roomId: "ABC123",
    players: [
      { seat: 0, name: "ana", connected: true },
      { seat: 1, name: "ben", connected: true },
    ],
    hostSeat: 0,
    playAgain: [],
    nextRoundReady: [],
    started: false,
    config: EAST_COAST,
    ...overrides,
  };
}

function viewUpdate(overrides: { serverNow?: number; roundNumber?: number } = {}): ViewUpdate {
  const { serverNow = 100_000, roundNumber = 1 } = overrides;
  return {
    view: {
      seat: 0,
      hand: [],
      foot: null,
      footCount: 13,
      melds: [],
      isDown: false,
      inFoot: false,
      opponents: [],
      discard: [],
      stockCount: 40,
      currentSeat: 0,
      phase: "draw",
      roundNumber,
      pickedUp: [],
      playedThisTurn: [],
      wentOutSeat: null,
      finalLapRemaining: null,
      scoresSoFar: [],
    },
    clock: { serverNow, deadlineAt: serverNow + 30_000, inDiscardGrace: false, paused: false },
    room: roomInfo({ started: true }),
    hints: {
      seatToAct: 0,
      phase: "draw",
      canDraw: true,
      canTakePile: false,
      meldableRanks: [],
      canGoOut: false,
    },
  };
}

/**
 * The store is a module singleton, so each test starts from a clean slate. The
 * clock is replaced rather than merely cleared: it carries a mutable offset, so a
 * test that anchored it would otherwise leak an anchored clock into the next one.
 */
beforeEach(() => {
  clearCredentials();
  useSession.setState({
    status: "connecting",
    credentials: null,
    room: null,
    update: null,
    result: null,
    notice: null,
    reactions: [],
    clock: createServerClock(),
  });
});

describe("connection status", () => {
  it("starts out connecting", () => {
    expect(useSession.getState().status).toBe("connecting");
  });

  it("follows the transport", () => {
    useSession.getState().setStatus("connected");
    expect(useSession.getState().status).toBe("connected");
    useSession.getState().setStatus("disconnected");
    expect(useSession.getState().status).toBe("disconnected");
  });
});

describe("holding a seat", () => {
  it("persists credentials so a reload can reclaim the seat", () => {
    // The point of storing them at all: the server accepts them back through
    // resumeSeat, which is what makes a refresh recoverable.
    const credentials = { roomId: "ABC123", seat: 1, token: "tok" };
    useSession.getState().seat(credentials);
    expect(useSession.getState().credentials).toEqual(credentials);
    expect(loadCredentials()).toEqual(credentials);
  });

  it("moves to the seat the server names, keeping the token", () => {
    useSession.getState().seat({ roomId: "ABC123", seat: 2, token: "tok" });
    useSession.getState().reseat(1);
    const moved = { roomId: "ABC123", seat: 1, token: "tok" };
    expect(useSession.getState().credentials).toEqual(moved);
    expect(loadCredentials()).toEqual(moved);
  });

  it("ignores a seat number when it holds no seat", () => {
    useSession.getState().reseat(1);
    expect(useSession.getState().credentials).toBeNull();
    expect(loadCredentials()).toBeNull();
  });

  it("forgets the seat and the table on leaving", () => {
    useSession.getState().seat({ roomId: "ABC123", seat: 0, token: "tok" });
    useSession.getState().applyUpdate(viewUpdate());
    useSession.getState().setNotice("something");

    useSession.getState().leave();

    const state = useSession.getState();
    expect(state.credentials).toBeNull();
    expect(state.room).toBeNull();
    expect(state.update).toBeNull();
    expect(state.result).toBeNull();
    expect(state.notice).toBeNull();
    // Left behind, it would try to reclaim a seat it has abandoned on next load.
    expect(loadCredentials()).toBeNull();
  });
});

describe("applying updates", () => {
  it("anchors the clock from the update before storing it", () => {
    // Anchoring after would leave the first render of a deadline reading it
    // through a zero offset.
    const state = useSession.getState();
    expect(state.clock.anchored).toBe(false);
    state.applyUpdate(viewUpdate({ serverNow: 500_000 }));
    expect(useSession.getState().clock.anchored).toBe(true);
    expect(useSession.getState().update?.clock.serverNow).toBe(500_000);
  });

  it("takes the room from the update, which is at least as fresh", () => {
    useSession.getState().applyRoom(roomInfo({ started: false }));
    useSession.getState().applyUpdate(viewUpdate());
    expect(useSession.getState().room?.started).toBe(true);
  });

  it("keeps a standalone room event when no update has arrived", () => {
    // The lobby runs entirely on `room`: there is no view until the game starts.
    useSession.getState().applyRoom(roomInfo());
    expect(useSession.getState().room?.roomId).toBe("ABC123");
    expect(useSession.getState().update).toBeNull();
  });

  it("keeps the scoreboard up while the round is still the same one", () => {
    useSession.getState().applyUpdate(viewUpdate({ roundNumber: 1 }));
    const result: RoundEnded = {
      scores: [{ seat: 0, score: 100, breakdown: NO_BREAKDOWN }],
      wentOutSeat: 0,
      roundNumber: 1,
      totals: [100],
      matchOver: false,
    };
    useSession.getState().applyResult(result);
    useSession.getState().applyUpdate(viewUpdate({ roundNumber: 1, serverNow: 101_000 }));
    expect(useSession.getState().result).toEqual(result);
  });

  it("clears the scoreboard when a new round is dealt", () => {
    // Otherwise the previous round's scores hang over the new deal.
    useSession.getState().applyUpdate(viewUpdate({ roundNumber: 1 }));
    useSession.getState().applyResult({
      scores: [{ seat: 0, score: 100, breakdown: NO_BREAKDOWN }],
      roundNumber: 1,
      totals: [100],
      matchOver: false,
    });
    useSession.getState().applyUpdate(viewUpdate({ roundNumber: 2 }));
    expect(useSession.getState().result).toBeNull();
  });

  it("carries the hints through to the store", () => {
    // The client cannot derive these, so losing them here would leave the UI
    // unable to tell which actions are open.
    useSession.getState().applyUpdate(viewUpdate());
    expect(useSession.getState().update?.hints.canDraw).toBe(true);
    expect(useSession.getState().update?.hints.seatToAct).toBe(0);
  });
});

describe("notices", () => {
  it("holds the last rejection and clears on request", () => {
    useSession.getState().setNotice("it is not your turn");
    expect(useSession.getState().notice).toBe("it is not your turn");
    useSession.getState().setNotice(null);
    expect(useSession.getState().notice).toBeNull();
  });
});

describe("attachSession", () => {
  /** Records handlers so the test can fire events, and what was detached. */
  function fakeSocket(): SessionSocket & {
    fire(event: string, payload?: unknown): void;
    readonly removed: string[];
  } {
    const handlers = new Map<string, (payload?: unknown) => void>();
    const removed: string[] = [];
    return {
      removed,
      on: ((event: string, handler: (payload?: unknown) => void) => {
        handlers.set(event, handler);
      }) as SessionSocket["on"],
      off: (event: string) => {
        removed.push(event);
        handlers.delete(event);
      },
      fire: (event, payload) => handlers.get(event)?.(payload),
    };
  }

  function sink(): SessionSink & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      setStatus: (status) => calls.push(`status:${status}`),
      applyRoom: () => calls.push("room"),
      applyUpdate: () => calls.push("update"),
      applyResult: () => calls.push("result"),
      reseat: (seat) => calls.push(`seat:${seat}`),
      applyReaction: (r) => calls.push(`reaction:${r.id}`),
    };
  }

  it("routes every broadcast into the store", () => {
    const socket = fakeSocket();
    const target = sink();
    attachSession(socket, target);

    socket.fire("connect");
    socket.fire("view", viewUpdate());
    socket.fire("room", roomInfo());
    socket.fire("roundEnded", { scores: [] });
    socket.fire("seat", 3);
    socket.fire("reaction", { seq: 1, seat: 1, id: "nice" });
    socket.fire("disconnect");

    expect(target.calls).toEqual([
      "status:connected",
      "update",
      "room",
      "result",
      "seat:3",
      "reaction:nice",
      "status:disconnected",
    ]);
  });

  it("detaches every listener it attached", () => {
    // React attaches this more than once — a remount in development, a reconnect
    // in production — and a listener left behind applies each update twice.
    const socket = fakeSocket();
    const detach = attachSession(socket, sink());
    detach();
    expect(socket.removed.sort()).toEqual(
      ["connect", "disconnect", "reaction", "room", "roundEnded", "seat", "view"].sort(),
    );
  });

  it("stops routing once detached", () => {
    const socket = fakeSocket();
    const target = sink();
    attachSession(socket, target)();
    socket.fire("connect");
    socket.fire("view", viewUpdate());
    expect(target.calls).toEqual([]);
  });

  it("drives the real store when wired to it", () => {
    // End to end through the actual zustand store rather than a spy, so the
    // wiring and the reducers are checked together at least once.
    const socket = fakeSocket();
    const { setStatus, applyRoom, applyUpdate, applyResult, reseat, applyReaction } =
      useSession.getState();
    attachSession(socket, {
      setStatus,
      applyRoom,
      applyUpdate,
      applyResult,
      reseat,
      applyReaction,
    });

    socket.fire("connect");
    socket.fire("view", viewUpdate());
    expect(useSession.getState().status).toBe("connected");
    expect(useSession.getState().update?.hints.canDraw).toBe(true);
    expect(useSession.getState().room?.started).toBe(true);
  });

  it("keeps the last few reactions heard, and forgets them with the table", () => {
    const { applyReaction } = useSession.getState();
    for (let seq = 1; seq <= KEPT_REACTIONS + 4; seq++) applyReaction({ seq, seat: 0, id: "nice" });
    const kept = useSession.getState().reactions;
    expect(kept).toHaveLength(KEPT_REACTIONS);
    expect(kept.at(-1)!.seq).toBe(KEPT_REACTIONS + 4);
    expect(KEPT_REACTIONS).toBe(16);
    useSession.getState().seat({ roomId: "OTHER2", seat: 0, token: "t" });
    expect(useSession.getState().reactions).toEqual([]);
    applyReaction({ seq: 1, seat: 0, id: "nice" });
    useSession.getState().leave();
    expect(useSession.getState().reactions).toEqual([]);
  });

  it("does not apply anything on its own", () => {
    // Attaching must be inert until the server actually says something; a store
    // reset on attach would wipe a seat mid-reconnect.
    const socket = fakeSocket();
    const target = sink();
    attachSession(socket, target);
    expect(target.calls).toEqual([]);
    expect(vi.isMockFunction(target.setStatus)).toBe(false);
  });
});

describe("moving to another table", () => {
  const ended = {
    scores: [],
    roundNumber: 1,
    totals: [],
    matchOver: false,
  } as unknown as RoundEnded;

  it("drops everything held about the old table when seated at a new one", () => {
    const store = useSession.getState();
    store.seat({ roomId: "OLD234", seat: 0, token: "a" });
    store.applyUpdate(viewUpdate({ roundNumber: 1 }));
    store.applyResult(ended);
    store.seat({ roomId: "NEW234", seat: 1, token: "b" });
    const now = useSession.getState();
    expect([now.room, now.update, now.result]).toEqual([null, null, null]);
    expect(now.credentials?.roomId).toBe("NEW234");
  });

  it("keeps the table's state when re-seated at the same one", () => {
    const store = useSession.getState();
    store.seat({ roomId: "ABC234", seat: 0, token: "a" });
    store.applyUpdate(viewUpdate({ roundNumber: 1 }));
    store.applyResult(ended);
    // Seats closing up in the lobby, or a reclaim: the same table.
    store.reseat(1);
    expect(useSession.getState().result).toBe(ended);
  });

  it("drops a scoreboard when a view arrives from another table at the same round", () => {
    const store = useSession.getState();
    store.applyUpdate(viewUpdate({ roundNumber: 1 }));
    store.applyResult(ended);
    const other = viewUpdate({ roundNumber: 1 });
    store.applyUpdate({ ...other, room: { ...other.room, roomId: "ZZZ999" } });
    expect(useSession.getState().result).toBeNull();
  });
});
