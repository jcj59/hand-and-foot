import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EAST_COAST, type RoomInfo, type ViewUpdate } from "@hf/shared";
import { App } from "./App";
import { createServerClock } from "./serverTime";
import { useSession, type SessionSocket } from "./session";

/**
 * A transport the test drives by hand.
 *
 * `fire` wraps the handler in `act`, because a broadcast arrives from outside
 * React: it lands in the zustand store directly, and without `act` the resulting
 * render is not flushed before the assertion reads the DOM.
 */
function fakeSocket(): SessionSocket & { fire(event: string, payload?: unknown): void } {
  const handlers = new Map<string, (payload?: unknown) => void>();
  return {
    on: ((event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
    }) as SessionSocket["on"],
    off: (event: string) => {
      handlers.delete(event);
    },
    fire: (event, payload) => {
      act(() => {
        handlers.get(event)?.(payload);
      });
    },
  };
}

function room(): RoomInfo {
  return {
    roomId: "ABC123",
    players: [{ seat: 0, name: "ana", connected: true }],
    hostSeat: 0,
    started: true,
    config: EAST_COAST,
  };
}

function update(): ViewUpdate {
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
    room: room(),
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

function mount(socket: SessionSocket, path = "/"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App socket={socket} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
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

describe("the shell", () => {
  it("shows the connecting banner before the socket is up", () => {
    mount(fakeSocket());
    expect(screen.getByRole("status").textContent).toMatch(/connecting/i);
  });

  it("hides the banner once connected", () => {
    const socket = fakeSocket();
    mount(socket);
    socket.fire("connect");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns that turns may be played for you when the socket drops", () => {
    // The server plays a dropped player's turns once the grace elapses, so this
    // is a consequence the player has to be told about, not decoration.
    const socket = fakeSocket();
    mount(socket);
    socket.fire("connect");
    socket.fire("disconnect");
    expect(screen.getByRole("status").textContent).toMatch(/turns may be played for you/i);
  });

  it("wires the socket to the store, so a broadcast reaches the screen", () => {
    // The end-to-end check for the shell: a `room` event with no React involvement
    // of its own has to land in the store and re-render.
    const socket = fakeSocket();
    mount(socket);
    socket.fire("room", room());
    expect(screen.getByText(/table ABC123/i)).not.toBeNull();
  });

  it("renders the table route from the latest update", () => {
    const socket = fakeSocket();
    mount(socket, "/room/ABC123");
    socket.fire("view", update());
    expect(screen.getByText(/round 3, seat 1 to act/i)).not.toBeNull();
  });

  it("waits quietly on the table route before the game starts", () => {
    mount(fakeSocket(), "/room/ABC123");
    expect(screen.getByText(/waiting for the game to start/i)).not.toBeNull();
  });

  it("detaches its listeners on unmount", () => {
    // React StrictMode mounts twice in development; listeners left behind would
    // apply every later update twice over.
    const socket = fakeSocket();
    const { unmount } = render(
      <MemoryRouter>
        <App socket={socket} />
      </MemoryRouter>,
    );
    unmount();
    socket.fire("room", room());
    expect(useSession.getState().room).toBeNull();
  });
});
