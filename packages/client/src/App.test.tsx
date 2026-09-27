import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EAST_COAST, type Ack, type RoomInfo, type ViewUpdate } from "@hf/shared";
import { App } from "./App";
import { CREDENTIALS_KEY, loadCredentials, saveCredentials } from "./credentials";
import { createServerClock } from "./serverTime";
import { useSession } from "./session";
import type { HfClientSocket } from "./socket";

/**
 * A transport the test drives by hand, with both halves the shell uses: listeners
 * for broadcasts and `emit` for requests.
 *
 * `fire` wraps the handler in `act`, because a broadcast arrives from outside
 * React — straight into the zustand store — and without `act` the resulting render
 * is not flushed before the assertion reads the DOM.
 */
function fakeSocket(answers: Ack<unknown>[] = []): {
  socket: HfClientSocket;
  fire(event: string, payload?: unknown): void;
  readonly sent: { event: string; args: unknown[] }[];
  readonly removed: string[];
} {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const sent: { event: string; args: unknown[] }[] = [];
  const removed: string[] = [];
  const queue = [...answers];
  const socket = {
    on: (event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
      return socket;
    },
    off: (event: string) => {
      removed.push(event);
      handlers.delete(event);
      return socket;
    },
    emit: (event: string, ...args: unknown[]) => {
      const ack = args[args.length - 1] as (result: Ack<unknown>) => void;
      sent.push({ event, args: args.slice(0, -1) });
      ack(queue.shift() ?? { ok: true, data: undefined });
      return socket;
    },
  } as unknown as HfClientSocket;
  return {
    socket,
    sent,
    removed,
    fire: (event, payload) => {
      act(() => {
        handlers.get(event)?.(payload);
      });
    },
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
    started: false,
    config: EAST_COAST,
    ...overrides,
  };
}

function viewUpdate(room: RoomInfo = roomInfo({ started: true })): ViewUpdate {
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
      currentSeat: 1,
      phase: "draw",
      roundNumber: 3,
    },
    clock: { serverNow: 1_000, deadlineAt: 31_000, inDiscardGrace: false, paused: false },
    room,
    hints: {
      seatToAct: 1,
      phase: "draw",
      canDraw: false,
      canTakePile: false,
      meldableRanks: [],
      canGoOut: false,
    },
  };
}

function mount(socket: HfClientSocket, path = "/"): { unmount: () => void } {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App socket={socket} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem(CREDENTIALS_KEY);
  useSession.setState({
    status: "connecting",
    credentials: null,
    room: null,
    update: null,
    result: null,
    notice: null,
    clock: createServerClock(),
  });
});

describe("the connection banner", () => {
  it("shows while connecting", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("status").textContent).toMatch(/connecting/i);
  });

  it("goes away once connected", () => {
    const socket = fakeSocket();
    mount(socket.socket);
    socket.fire("connect");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns that turns may be played for you when the socket drops", () => {
    // The server plays a dropped player's turns once the grace elapses, so this is
    // a consequence the player has to be told about, not decoration.
    const socket = fakeSocket();
    mount(socket.socket);
    socket.fire("connect");
    socket.fire("disconnect");
    expect(screen.getByRole("status").textContent).toMatch(/turns may be played for you/i);
  });
});

describe("routing", () => {
  it("starts on the home screen", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("heading", { name: /hand and foot/i })).toBeInTheDocument();
  });

  it("offers the join form to a visitor arriving at a table with no seat", () => {
    mount(fakeSocket().socket, "/room/abc234");
    expect(screen.getByLabelText(/table code/i)).toHaveValue("ABC234");
  });

  it("shows the lobby once seated at a table that has not dealt", () => {
    const socket = fakeSocket();
    mount(socket.socket, "/room/ABC234");
    act(() => {
      useSession.getState().seat({ roomId: "ABC234", seat: 1, token: "t1" });
    });
    socket.fire("room", roomInfo());
    expect(screen.getByRole("heading", { name: /table ABC234/i })).toBeInTheDocument();
  });

  it("shows the table once the room says it has started", () => {
    // The server owns that transition, so the client reads `started` rather than
    // tracking it.
    const socket = fakeSocket();
    mount(socket.socket, "/room/ABC234");
    act(() => {
      useSession.getState().seat({ roomId: "ABC234", seat: 0, token: "t0" });
    });
    socket.fire("view", viewUpdate());
    expect(screen.getByText(/round 3, seat 1 to act/i)).toBeInTheDocument();
  });

  it("sends an unknown URL back to the home screen", () => {
    mount(fakeSocket().socket, "/nonsense");
    expect(screen.getByRole("heading", { name: /hand and foot/i })).toBeInTheDocument();
  });
});

describe("reclaiming a stored seat", () => {
  it("asks for the seat back once the socket is up", async () => {
    // This is what makes a reload recoverable rather than a lost place.
    saveCredentials({ roomId: "ABC234", seat: 1, token: "tok" });
    const socket = fakeSocket([{ ok: true, data: { roomId: "ABC234", seat: 1, token: "tok" } }]);
    mount(socket.socket);
    socket.fire("connect");
    await waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent[0]).toEqual({
      event: "resumeSeat",
      args: [{ roomId: "ABC234", seat: 1, token: "tok" }],
    });
    expect(useSession.getState().credentials?.seat).toBe(1);
  });

  it("sits in the seat the server resolved, not the stale stored one", async () => {
    // The host left while this browser was away and the seats closed up.
    saveCredentials({ roomId: "ABC234", seat: 1, token: "tok" });
    const socket = fakeSocket([{ ok: true, data: { roomId: "ABC234", seat: 0, token: "tok" } }]);
    mount(socket.socket);
    socket.fire("connect");
    await waitFor(() => expect(useSession.getState().credentials?.seat).toBe(0));
    expect(loadCredentials()?.seat).toBe(0);
  });
});

describe("moving up a seat", () => {
  it("becomes the host when the host leaves the lobby ahead of it", () => {
    useSession.getState().seat({ roomId: "ABC234", seat: 1, token: "tok" });
    const socket = fakeSocket();
    mount(socket.socket, "/room/ABC234");
    socket.fire("room", roomInfo());
    expect(screen.queryByRole("button", { name: /deal/i })).not.toBeInTheDocument();

    socket.fire("seat", 0);
    socket.fire(
      "room",
      roomInfo({
        players: [
          { seat: 0, name: "ben", connected: true },
          { seat: 1, name: "cy", connected: true },
        ],
      }),
    );
    expect(useSession.getState().credentials?.seat).toBe(0);
    expect(loadCredentials()?.seat).toBe(0);
    expect(screen.getByRole("button", { name: /deal/i })).toBeInTheDocument();
  });

  it("waits for the connection rather than sending into a dead socket", () => {
    saveCredentials({ roomId: "ABC234", seat: 1, token: "tok" });
    const socket = fakeSocket();
    mount(socket.socket);
    expect(socket.sent).toEqual([]);
  });

  it("does nothing when there is no stored seat", () => {
    const socket = fakeSocket();
    mount(socket.socket);
    socket.fire("connect");
    expect(socket.sent).toEqual([]);
  });

  it("discards credentials the server will not honour", async () => {
    // Expected rather than exceptional: the round may have ended or the room been
    // reaped. Keeping them would retry a doomed reclaim on every load.
    saveCredentials({ roomId: "ABC234", seat: 1, token: "stale" });
    const socket = fakeSocket([{ ok: false, error: "that seat is not yours" }]);
    mount(socket.socket);
    socket.fire("connect");
    await waitFor(() => expect(loadCredentials()).toBeNull());
    expect(useSession.getState().credentials).toBeNull();
    // And says nothing about it: the player did not ask for this.
    expect(useSession.getState().notice).toBeNull();
  });

  it("tries only once, however many times the socket reconnects", async () => {
    // A refusal means the seat is genuinely gone and the credentials are discarded,
    // so a retry could only fail again.
    saveCredentials({ roomId: "ABC234", seat: 1, token: "tok" });
    const socket = fakeSocket([{ ok: true, data: undefined }]);
    mount(socket.socket);
    socket.fire("connect");
    await waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.fire("disconnect");
    socket.fire("connect");
    await waitFor(() => expect(socket.sent).toHaveLength(1));
  });

  it("leaves a seat already held in this tab alone", () => {
    // Reclaiming is for a fresh load; a live seat needs nothing.
    saveCredentials({ roomId: "ABC234", seat: 1, token: "tok" });
    useSession.setState({ credentials: { roomId: "ABC234", seat: 1, token: "tok" } });
    const socket = fakeSocket();
    mount(socket.socket);
    socket.fire("connect");
    expect(socket.sent).toEqual([]);
  });
});

describe("listener lifecycle", () => {
  it("detaches everything it attached", () => {
    // React StrictMode mounts twice in development; listeners left behind would
    // apply every later update twice over.
    const socket = fakeSocket();
    const { unmount } = mount(socket.socket);
    unmount();
    expect(socket.removed.sort()).toEqual(
      ["connect", "disconnect", "room", "roundEnded", "seat", "view"].sort(),
    );
  });

  it("stops applying updates after unmount", () => {
    const socket = fakeSocket();
    const { unmount } = mount(socket.socket);
    unmount();
    socket.fire("room", roomInfo());
    expect(useSession.getState().room).toBeNull();
  });
});
