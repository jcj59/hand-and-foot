import { describe, it, expect, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  defaultAvatar,
  EAST_COAST,
  WEST_COAST,
  type Ack,
  type RoomInfo,
  type RulesConfig,
} from "@hf/shared";
import { CREDENTIALS_KEY, loadCredentials } from "../credentials";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Lobby, spacedCode } from "./Lobby";

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
    playAgain: [],
    nextRoundReady: [],
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
    // The QR code holds the link anyone can follow to a seat here.
    expect(
      screen.getByRole("img", { name: "QR code to join table ABC234" }).getAttribute("data-qr"),
    ).toBe(`${window.location.origin}/room/ABC234`);
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
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
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
        fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy());
        expect(screen.queryByRole("alert")).toBeNull();
      },
    );
  });
});

describe("the seat list", () => {
  it("lists everyone, marking the host and yourself", () => {
    seated(1);
    mount(fakeSocket().socket);
    const table = screen.getByRole("region", { name: "Around the table" });
    expect(within(table).getByText("ana")).toBeInTheDocument();
    expect(within(table).getByText("host")).toBeInTheDocument();
    // Yourself as You, with your name for a screen reader.
    expect(within(table).getByText(/You/)).toHaveTextContent("You (ben)");
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
    const table = screen.getByRole("region", { name: "Around the table" });
    expect(within(table).getAllByText("reconnecting")).toHaveLength(1);
    expect(within(table).getByText("ben").parentElement).toHaveTextContent("reconnecting");
  });

  it("counts the seats against the maximum", () => {
    seated(0);
    mount(fakeSocket().socket);
    // Two of eight seats taken; the host sees the rest as invitations.
    expect(screen.getAllByRole("button", { name: "Invite someone to this seat" })).toHaveLength(4);
  });
});

describe("dealing", () => {
  it("offers the deal to the host once there are enough players", async () => {
    const { socket, sent } = fakeSocket();
    seated(0);
    mount(socket);
    const deal = screen.getByRole("button", { name: "Deal · 2 players" });
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
    expect(screen.getByText("Waiting for ana")).toBeInTheDocument();
    expect(screen.getByText(/ana is the host/)).toBeInTheDocument();
  });

  it("surfaces a refused deal", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "a game needs at least 2 players" }]);
    seated(0);
    mount(socket);
    fireEvent.click(screen.getByRole("button", { name: "Deal · 2 players" }));
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
    fireEvent.click(screen.getByRole("button", { name: /leave table/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /leave table/i }));
    await waitFor(() => expect(useSession.getState().credentials).toBeNull());
    expect(loadCredentials()).toBeNull();
  });
});

describe("the rules summary", () => {
  /** The table's rules, opened from the waiting room's rules row. */
  const rules = (): HTMLElement => {
    const open = screen.queryByRole("region", { name: "Table rules" });
    if (open) return open;
    fireEvent.click(
      screen.getByRole("button", { name: /^(house rules|table rules|read all the table)/i }),
    );
    return screen.getByRole("region", { name: "Table rules" });
  };

  it("names the preset and mode the table was opened with", () => {
    seated(0, roomInfo({ config: { ...WEST_COAST, mode: "competitive", pauseEnabled: false } }));
    mount(fakeSocket().socket);
    expect(within(rules()).getByRole("heading", { level: 2 })).toHaveTextContent(
      /^Rules: West Coast · Competitive$/,
    );
  });

  it("names the family mode too, and lists nothing as changed for a preset as it comes", () => {
    seated(0);
    mount(fakeSocket().socket);
    expect(within(rules()).getByRole("heading", { level: 2 })).toHaveTextContent(
      /^Rules: East Coast · Family$/,
    );
    expect(within(rules()).queryByRole("list", { name: "Changed from the preset" })).toBeNull();
    expect(rules().querySelectorAll("[data-changed]")).toHaveLength(0);
  });

  it("shows every player what was changed, each beside the preset's value", () => {
    const config = {
      ...EAST_COAST,
      handSize: 11,
      marvaRule: false,
      scoring: { ...EAST_COAST.scoring, redThree: -300 },
      timers: { ...EAST_COAST.timers, baseMs: 45_000 },
    };
    seated(1, roomInfo({ config }));
    mount(fakeSocket().socket);
    expect(within(rules()).getByText("4 changed")).toBeInTheDocument();
    const changed = within(rules()).getByRole("list", { name: "Changed from the preset" });
    expect(
      within(changed)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Marva ruleOff, the preset has On",
      "Hand11 cards, the preset has 14 cards",
      "Red three−300, the preset has −500",
      "Time per turn45 s, the preset has 1 min 30 s",
    ]);
    // And the full list marks the same four.
    expect(rules().querySelectorAll("details [data-changed]")).toHaveLength(4);
  });

  it("reads a table opened before the editor as the preset it was opened with", () => {
    const old = JSON.parse(JSON.stringify({ ...WEST_COAST, preset: undefined })) as RulesConfig;
    seated(0, roomInfo({ config: old }));
    mount(fakeSocket().socket);
    expect(within(rules()).getByRole("heading", { level: 2 })).toHaveTextContent(/West Coast/);
    expect(rules().querySelectorAll("[data-changed]")).toHaveLength(0);
  });
});

describe("handing hosting on", () => {
  it("lets the host make another player the host", async () => {
    const socket = fakeSocket();
    seated(0);
    mount(socket.socket);
    fireEvent.click(screen.getByRole("button", { name: "Make ben the host" }));
    await waitFor(() => expect(socket.sent).toEqual([{ event: "setHost", args: [{ seat: 1 }] }]));
  });

  it("offers it only to the host, and never on the host's own row", () => {
    seated(0);
    mount(fakeSocket().socket);
    expect(screen.queryByRole("button", { name: "Make ana the host" })).toBeNull();
    act(() => useSession.getState().applyRoom(roomInfo({ hostSeat: 1 })));
    expect(screen.queryByRole("button", { name: /make .* the host/i })).toBeNull();
  });

  it("surfaces a refusal", async () => {
    const socket = fakeSocket([
      { ok: false, error: "the host can only be changed before the deal" },
    ]);
    seated(0);
    mount(socket.socket);
    fireEvent.click(screen.getByRole("button", { name: "Make ben the host" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/before the deal/));
  });
});

describe("pictures in the lobby", () => {
  it("shows each player's face: the one they chose, or the one their name gives", () => {
    const ana = {
      background: "rose",
      skin: "sand",
      eyes: "wink",
      mouth: "grin",
      top: "crown",
    } as const;
    seated(
      0,
      roomInfo({
        players: [
          { seat: 0, name: "ana", connected: true, avatar: ana },
          { seat: 1, name: "ben", connected: true },
        ],
      }),
    );
    mount(fakeSocket().socket);
    const faces = [...document.querySelectorAll("li [data-avatar]")].map((f) =>
      f.getAttribute("data-avatar"),
    );
    expect(faces).toEqual([
      "rose sand wink grin crown",
      Object.values(defaultAvatar("ben")).join(" "),
    ]);
  });
});

describe("computer players in the lobby", () => {
  const withBot = roomInfo({
    players: [
      { seat: 0, name: "ana", connected: true },
      { seat: 1, name: "Robo Rita", connected: true, bot: true },
    ],
  });

  it("lets the host add one", async () => {
    const socket = fakeSocket();
    seated(0);
    mount(socket.socket);
    fireEvent.click(screen.getByRole("button", { name: "+ Add computer" }));
    await waitFor(() => expect(socket.sent).toEqual([{ event: "addBot", args: [undefined] }]));
  });

  it("marks one as a computer, with no connection dot, and lets the host take it away", async () => {
    const socket = fakeSocket();
    seated(0, withBot);
    mount(socket.socket);
    const table = screen.getByRole("region", { name: "Around the table" });
    const seat = within(table).getByText("Robo Rita").closest("li")!;
    // Its level, and never "reconnecting": a computer is always at the table.
    expect(seat).toHaveTextContent("Hard, computer");
    expect(seat).not.toHaveTextContent("reconnecting");
    // A computer cannot host, so it is never offered the deal.
    expect(screen.queryByRole("button", { name: "Make Robo Rita the host" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Robo Rita, Hard" }));
    fireEvent.click(screen.getByRole("button", { name: "Take Robo Rita away" }));
    await waitFor(() => expect(socket.sent).toEqual([{ event: "removeBot", args: [{ seat: 1 }] }]));
  });

  it("offers neither to anyone but the host", () => {
    seated(
      1,
      roomInfo({
        ...withBot,
        players: [...withBot.players, { seat: 2, name: "ben", connected: true }],
      }),
    );
    mount(fakeSocket().socket);
    expect(screen.queryByRole("button", { name: "+ Add computer" })).toBeNull();
    expect(screen.queryByRole("button", { name: /take .* away/i })).toBeNull();
  });

  it("cannot add one to a full table, and surfaces a refusal", async () => {
    const full = roomInfo({
      players: Array.from({ length: 8 }, (_, seat) => ({
        seat,
        name: `p${seat}`,
        connected: true,
      })),
    });
    seated(0, full);
    mount(fakeSocket().socket);
    expect(screen.getByRole("button", { name: "+ Add computer" })).toBeDisabled();
    cleanup();
    const socket = fakeSocket([{ ok: false, error: "a table seats at most 8" }]);
    seated(0);
    mount(socket.socket);
    fireEvent.click(screen.getByRole("button", { name: "+ Add computer" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("a table seats at most 8"),
    );
  });
});

describe("the watch link", () => {
  it("is offered in the lobby, with how many are watching", () => {
    seated(0, roomInfo({ watching: 2 }));
    mount(fakeSocket().socket);
    expect(screen.getByRole("button", { name: "Copy the watch link" })).toBeInTheDocument();
    expect(screen.getByText("2 watching")).toBeInTheDocument();
  });
});

describe("the waiting room's new parts", () => {
  it("lets the host rename a computer and change how well it plays", async () => {
    const socket = fakeSocket();
    seated(
      0,
      roomInfo({
        players: [
          { seat: 0, name: "ana", connected: true },
          { seat: 1, name: "Robo Rita", connected: true, bot: true, botLevel: "standard" },
        ],
      }),
    );
    mount(socket.socket);
    fireEvent.click(screen.getByRole("button", { name: "Edit Robo Rita, Standard" }));
    fireEvent.click(screen.getByRole("radio", { name: "Easy" }));
    await waitFor(() =>
      expect(socket.sent).toEqual([{ event: "updateBot", args: [{ seat: 1, level: "easy" }] }]),
    );
    fireEvent.change(screen.getByLabelText("Name at the table"), { target: { value: "Shuffles" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(socket.sent.at(-1)).toEqual({
        event: "updateBot",
        args: [{ seat: 1, name: "Shuffles" }],
      }),
    );
  });

  it("lets a guest change their own card", async () => {
    const socket = fakeSocket();
    seated(1);
    mount(socket.socket);
    fireEvent.click(screen.getByRole("button", { name: "Change my card" }));
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Benny" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my card" }));
    await waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(socket.sent[0]!.event).toBe("changeCard");
    expect(socket.sent[0]!.args[0]).toMatchObject({ name: "Benny" });
  });

  it("prints the code in two halves", () => {
    expect(spacedCode("K7QM2P")).toBe("K7Q·M2P");
    expect(spacedCode("ABC")).toBe("ABC");
  });
});
