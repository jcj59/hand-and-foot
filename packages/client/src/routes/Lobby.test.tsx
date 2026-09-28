import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EAST_COAST, type Ack, type RoomInfo } from "@hf/shared";
import { CREDENTIALS_KEY, loadCredentials } from "../credentials";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Lobby } from "./Lobby";

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
    gameNumber: 1,
    playAgain: [],
    started: false,
    config: EAST_COAST,
    ...overrides,
  };
}

/** Seat this browser and give it a room, the state the lobby renders from. */
function seated(seat: number, room: RoomInfo = roomInfo()): void {
  useSession.setState({
    credentials: { roomId: room.roomId, seat, token: `t${seat}` },
    room,
  });
}

/**
 * Run a test with a stand-in clipboard. jsdom provides none, and the real one is
 * not writable, so the property is replaced and restored around the body.
 */
async function withClipboard(
  writeText: (text: string) => Promise<void>,
  body: () => Promise<void>,
): Promise<void> {
  const real = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  try {
    await body();
  } finally {
    if (real) Object.defineProperty(navigator, "clipboard", real);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
}

function mount(socket: HfClientSocket): void {
  render(
    <MemoryRouter>
      <Lobby socket={socket} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem(CREDENTIALS_KEY);
  useSession.setState({
    status: "connected",
    credentials: null,
    room: null,
    update: null,
    result: null,
    notice: null,
    clock: createServerClock(),
  });
});

describe("before the room arrives", () => {
  it("says it is joining rather than rendering an empty table", () => {
    // The room event lands just after the seat is granted, so a moment of nothing
    // is normal and should not look like a fault.
    mount(fakeSocket().socket);
    expect(screen.getByText(/joining the table/i)).toBeInTheDocument();
  });
});

describe("the invite", () => {
  it("shows a link built from the running origin", () => {
    seated(0);
    mount(fakeSocket().socket);
    expect(screen.getByLabelText(/shareable table link/i)).toHaveValue(
      `${window.location.origin}/room/ABC234`,
    );
  });

  it("names the table in the heading", () => {
    seated(0);
    mount(fakeSocket().socket);
    expect(screen.getByRole("heading", { name: /table ABC234/i })).toBeInTheDocument();
  });

  it("copies the link and confirms it", async () => {
    const written: string[] = [];
    await withClipboard(
      (text) => {
        written.push(text);
        return Promise.resolve();
      },
      async () => {
        seated(0);
        mount(fakeSocket().socket);
        fireEvent.click(screen.getByRole("button", { name: /copy/i }));
        await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy());
        expect(written).toEqual([`${window.location.origin}/room/ABC234`]);
      },
    );
  });

  it("says nothing when the clipboard refuses", async () => {
    // Refused on an insecure origin, or when a permission prompt is declined. The
    // link is on screen to copy by hand, so this is not worth an error.
    await withClipboard(
      () => Promise.reject(new Error("denied")),
      async () => {
        seated(0);
        mount(fakeSocket().socket);
        fireEvent.click(screen.getByRole("button", { name: /copy/i }));
        await waitFor(() => expect(screen.getByRole("button", { name: /^copy$/i })).toBeTruthy());
        expect(screen.queryByRole("alert")).toBeNull();
      },
    );
  });
});

describe("the seat list", () => {
  it("lists everyone, marking the host and yourself", () => {
    seated(1);
    mount(fakeSocket().socket);
    expect(screen.getByText("ana")).toBeInTheDocument();
    expect(screen.getByText("ben")).toBeInTheDocument();
    expect(screen.getByText("host")).toBeInTheDocument();
    expect(screen.getByText("you")).toBeInTheDocument();
  });

  it("shows who has dropped", () => {
    // It matters before the deal as much as after: once dealt, a disconnected seat
    // has its turns played for it.
    seated(
      0,
      roomInfo({
        players: [
          { seat: 0, name: "ana", connected: true },
          { seat: 1, name: "ben", connected: false },
        ],
      }),
    );
    mount(fakeSocket().socket);
    expect(screen.getByLabelText("disconnected")).toBeInTheDocument();
    expect(screen.getAllByLabelText("connected")).toHaveLength(1);
  });

  it("counts the seats against the maximum", () => {
    seated(0);
    mount(fakeSocket().socket);
    expect(screen.getByText(/players \(2\/8\)/i)).toBeInTheDocument();
  });
});

describe("dealing", () => {
  it("offers the deal to the host once there are enough players", async () => {
    const { socket, sent } = fakeSocket();
    seated(0);
    mount(socket);
    const deal = screen.getByRole("button", { name: /^deal$/i });
    expect(deal).not.toBeDisabled();
    fireEvent.click(deal);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].event).toBe("startGame");
  });

  it("tells the host how many more are needed", () => {
    // Gated here as well as on the server, because an enabled button that bounces
    // is worse than one that explains itself.
    seated(0, roomInfo({ players: [{ seat: 0, name: "ana", connected: true }] }));
    mount(fakeSocket().socket);
    const deal = screen.getByRole("button", { name: /waiting for 1 more/i });
    expect(deal).toBeDisabled();
  });

  it("offers nothing to a guest", () => {
    // Mirrors the server's rule rather than restating its reasoning: hostSeat says
    // whose button it is.
    seated(1);
    mount(fakeSocket().socket);
    expect(screen.queryByRole("button", { name: /deal/i })).toBeNull();
    expect(screen.getByText(/waiting for the host to deal/i)).toBeInTheDocument();
  });

  it("surfaces a refused deal", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "a game needs at least 2 players" }]);
    seated(0);
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: /^deal$/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/at least 2/i));
  });
});

describe("leaving", () => {
  it("forgets the seat, so the stored credentials are not a trap", async () => {
    // Without this a seat at a table that never deals would be reclaimed on every
    // load with no way out.
    seated(0);
    useSession.getState().seat({ roomId: "ABC234", seat: 0, token: "t0" });
    expect(loadCredentials()).not.toBeNull();

    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: /leave this table/i }));

    await waitFor(() => expect(useSession.getState().credentials).toBeNull());
    expect(loadCredentials()).toBeNull();
    expect(useSession.getState().room).toBeNull();
    // And the server is told, so the seat is freed for the players still here.
    expect(sent).toEqual([{ event: "leaveRoom", args: [] }]);
  });

  it("still leaves when the server refuses", async () => {
    seated(0);
    useSession.getState().seat({ roomId: "ABC234", seat: 0, token: "t0" });
    mount(fakeSocket([{ ok: false, error: "you are not seated in a room" }]).socket);
    fireEvent.click(screen.getByRole("button", { name: /leave this table/i }));
    await waitFor(() => expect(useSession.getState().credentials).toBeNull());
    expect(loadCredentials()).toBeNull();
  });
});

describe("the rules summary", () => {
  it("names the mode the table was opened with", () => {
    seated(0, roomInfo({ config: { ...EAST_COAST, mode: "competitive" } }));
    mount(fakeSocket().socket);
    expect(screen.getByText(/competitive rules/i)).toBeInTheDocument();
  });

  it("names the family mode too", () => {
    seated(0);
    mount(fakeSocket().socket);
    expect(screen.getByText(/family rules/i)).toBeInTheDocument();
  });
});
