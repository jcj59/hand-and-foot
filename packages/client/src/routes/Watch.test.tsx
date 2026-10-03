import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EAST_COAST, type Ack, type RoomInfo, type ViewUpdate } from "@hf/shared";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Watch } from "./Watch";

function fakeSocket(answer: Ack<unknown>): {
  socket: HfClientSocket;
  sent: { event: string; args: unknown[] }[];
} {
  const sent: { event: string; args: unknown[] }[] = [];
  const socket = {
    emit: (event: string, ...args: unknown[]) => {
      const ack = args[args.length - 1] as (result: Ack<unknown>) => void;
      sent.push({ event, args: args.slice(0, -1) });
      ack(event === "watchRoom" ? answer : { ok: true, data: undefined });
      return socket;
    },
    on: () => socket,
    off: () => socket,
  } as unknown as HfClientSocket;
  return { socket, sent };
}

const room: RoomInfo = {
  roomId: "ABC234",
  players: [
    { seat: 0, name: "ana", connected: true },
    { seat: 1, name: "Robo Rita", connected: true, bot: true },
  ],
  hostSeat: 0,
  started: false,
  playAgain: [],
  nextRoundReady: [],
  config: EAST_COAST,
  watching: 1,
};

function spectatorUpdate(): ViewUpdate {
  return {
    view: {
      seat: -1,
      hand: [],
      foot: null,
      footCount: 0,
      melds: [],
      isDown: false,
      inFoot: false,
      opponents: [
        { seat: 0, handCount: 11, footCount: 11, melds: [], isDown: false, inFoot: false },
        { seat: 1, handCount: 12, footCount: 11, melds: [], isDown: false, inFoot: false },
      ],
      discard: [{ id: "d1", rank: "9", suit: "clubs" }],
      stockCount: 80,
      currentSeat: 0,
      phase: "draw",
      roundNumber: 1,
      pickedUp: [],
      playedThisTurn: [],
      wentOutSeat: null,
      finalLapRemaining: null,
      scoresSoFar: [0, 0],
      departed: [],
    },
    clock: { serverNow: 0, deadlineAt: null, inDiscardGrace: false, paused: false },
    room: { ...room, started: true },
    hints: {
      seatToAct: 0,
      phase: "draw",
      canDraw: false,
      canTakePile: false,
      meldableRanks: [],
      canGoOut: false,
    },
  };
}

function mount(socket: HfClientSocket, at = "/watch/abc234"): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/watch/:roomId" element={<Watch socket={socket} />} />
        <Route path="/" element={<p>main screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSession.setState({
    status: "connected",
    credentials: null,
    room: null,
    update: null,
    result: null,
    notice: null,
    reactions: [],
    clock: createServerClock(),
  });
});

describe("watching a table", () => {
  it("asks to watch the table its link names, and shows who is waiting before the deal", async () => {
    const { socket, sent } = fakeSocket({ ok: true, data: room });
    mount(socket);
    expect(sent[0]).toEqual({ event: "watchRoom", args: [{ roomId: "ABC234" }] });
    act(() => useSession.getState().applyRoom(room));
    expect(
      await screen.findByRole("heading", { name: "Watching table ABC234" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Waiting to play" })).toHaveTextContent("ana");
    expect(screen.getByRole("list", { name: "Waiting to play" })).toHaveTextContent("computer");
  });

  it("shows the table once dealt, with nothing to click and no hand of its own", () => {
    mount(fakeSocket({ ok: true, data: room }).socket);
    act(() => useSession.getState().applyUpdate(spectatorUpdate()));
    expect(screen.getByText(/Watching table ABC234/)).toBeInTheDocument();
    expect(screen.getByText(/Every player’s cards stay hidden/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /hand$/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /melds$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /react/i })).toBeNull();
    expect(screen.getByLabelText("Watching")).toHaveTextContent("1 watching");
  });

  it("says so when there is no table at that code", async () => {
    mount(fakeSocket({ ok: false, error: "no room with that code" }).socket);
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no table with that code");
  });

  it("lets go of the table when the watcher leaves the page, without touching a stored seat", async () => {
    const { socket, sent } = fakeSocket({ ok: true, data: room });
    useSession.setState({ credentials: { roomId: "OTHER2", seat: 0, token: "t" } });
    const { unmount } = mount(socket);
    act(() => useSession.getState().applyUpdate(spectatorUpdate()));
    unmount();
    await waitFor(() => expect(sent.map((s) => s.event)).toContain("leaveRoom"));
    expect(useSession.getState().update).toBeNull();
    expect(useSession.getState().credentials).toEqual({ roomId: "OTHER2", seat: 0, token: "t" });
  });
});
