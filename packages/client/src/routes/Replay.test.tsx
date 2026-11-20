import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  EAST_COAST,
  NO_SUCH_MATCH,
  type Ack,
  type Action,
  type GameState,
  type ReplayMatch,
} from "@hf/shared";
import { applyAction, deal, heuristicPolicy } from "@hf/engine";
import { httpPost, IDENTITY_KEY, saveIdentity, TOO_MANY_REQUESTS, type Post } from "../identity";
import { useSession } from "../session";
import {
  loadReplay,
  NO_PROFILE,
  Replay,
  REPLAY_RETRY_MS,
  timelineOf,
  UNPLAYABLE,
  UNREACHABLE,
  type ReplayFrom,
} from "./Replay";

const user = { userId: "u".repeat(16), secret: "s".repeat(32) };

/** Forty real moves of a three-seat game, recorded as the server keeps them. */
function match(moves = 40): ReplayMatch {
  let state: GameState = deal(3, EAST_COAST, 7, 1, 2);
  const log: { seat: number; action: Action; source: "player" | "bot" }[] = [];
  for (let i = 0; i < moves && !state.roundEnded; i++) {
    const seat = state.currentSeat;
    const action = heuristicPolicy(state, seat)!;
    log.push({ seat, action, source: seat === 2 ? "bot" : "player" });
    state = (applyAction(state, action) as { state: GameState }).state;
  }
  return {
    id: "m1",
    roomId: "ABC234",
    startedAt: new Date(2026, 9, 1, 19).getTime(),
    endedAt: new Date(2026, 9, 1, 21).getTime(),
    config: EAST_COAST,
    seed: 7,
    firstSeat: 2,
    seats: [
      { seat: 0, name: "Ana" },
      { seat: 1, name: "Ben" },
      { seat: 2, name: "Robo Rita", bot: true },
    ],
    log,
    summary: {
      roundsPlayed: 0,
      rounds: [],
      totals: [0, 0, 0],
      finished: false,
      winners: [],
      departed: [],
      tallies: [],
    },
    seat: 1,
  };
}

function server(answer: Ack<ReplayMatch> | Error): { post: Post; asked: unknown[] } {
  const asked: unknown[] = [];
  const post: Post = async (path, body) => {
    asked.push({ path, body });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { post, asked };
}

/** Answers in turn, the last one again for any further ask. */
function answers(...replies: Ack<ReplayMatch>[]): { post: Post; asked: unknown[] } {
  const asked: unknown[] = [];
  const post: Post = async (path, body) => {
    asked.push({ path, body });
    return replies[Math.min(asked.length - 1, replies.length - 1)]!;
  };
  return { post, asked };
}

function mount(post: Post, at = "/replay/m1", from?: ReplayFrom): void {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: at.split("#")[0]!,
          hash: at.split("#")[1] ? `#${at.split("#")[1]}` : "",
          state: from,
        },
      ]}
    >
      <Routes>
        <Route path="/replay/:matchId" element={<Replay post={post} />} />
        <Route path="/" element={<p>main screen</p>} />
        <Route path="/room/:roomId" element={<p>the table</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem(IDENTITY_KEY);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => useSession.getState().leave());
});

describe("watching a past game again", () => {
  it("asks for the game as this identity, and plays it from the player's own seat", async () => {
    saveIdentity(user);
    const { post, asked } = server({ ok: true, data: match() });
    mount(post);
    expect(await screen.findByText(/Table ABC234 · Oct 1/)).toBeInTheDocument();
    expect(asked).toEqual([{ path: "/api/users/match", body: { user, id: "m1" } }]);
    // Ben's seat, the player's own, is the one watched.
    expect(screen.getByRole("combobox", { name: "Watch" })).toHaveValue("1");
  });

  it("opens at the point a link names, on the seat it names", async () => {
    saveIdentity(user);
    mount(server({ ok: true, data: match() }).post, "/replay/m1#step=12&seat=0");
    await screen.findByText(/Table ABC234/);
    expect(screen.getByRole("combobox", { name: "Watch" })).toHaveValue("0");
    expect(screen.getByText(/move 12 of 40/)).toBeInTheDocument();
  });

  it("names the watched player in the scores and the result, never as 'you'", async () => {
    saveIdentity(user);
    const whole = match(5000);
    mount(server({ ok: true, data: whole }).post, `/replay/m1#step=${whole.log.length}&seat=1`);
    const result = await screen.findByLabelText(/round result/i);
    expect(within(result).getByRole("listitem", { name: /^Ben:/ }).textContent).toMatch(/^\d+Ben/);
    expect(result.textContent).not.toMatch(/\byou\b/i);
    const sidePanel = screen.getAllByText("Ben");
    expect(sidePanel.length).toBeGreaterThan(1);
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("says why a browser without the player's profile cannot watch it, and asks nothing", async () => {
    const { post, asked } = server({ ok: true, data: match() });
    mount(post);
    expect(await screen.findByRole("alert")).toHaveTextContent(NO_PROFILE);
    expect(asked).toEqual([]);
  });

  it("shows the server's refusal, and a way back", async () => {
    saveIdentity(user);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mount(server({ ok: false, error: "that game is not one of yours" }).post);
    await act(() => vi.advanceTimersByTimeAsync(REPLAY_RETRY_MS));
    vi.useRealTimers();
    expect(await screen.findByRole("alert")).toHaveTextContent("That game is not one of yours.");
    screen.getByRole("button", { name: "Back to the main screen" }).click();
    await waitFor(() => expect(screen.getByText("main screen")).toBeInTheDocument());
  });

  it("says quietly that the server is busy when it refuses for too many reads, and asks once", async () => {
    saveIdentity(user);
    let asks = 0;
    const replies = [
      new Response(JSON.stringify({ ok: false, error: TOO_MANY_REQUESTS }), { status: 429 }),
      new Response("<html>slow down</html>", { status: 429 }),
    ];
    for (const reply of replies) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          asks++;
          return reply;
        }),
      );
      try {
        const { unmount } = render(
          <MemoryRouter initialEntries={["/replay/m1"]}>
            <Routes>
              <Route path="/replay/:matchId" element={<Replay post={httpPost("")} />} />
            </Routes>
          </MemoryRouter>,
        );
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Too many requests; try again in a minute.",
        );
        unmount();
      } finally {
        vi.unstubAllGlobals();
      }
    }
    expect(asks).toBe(2);
  });

  it("says when the server could not be reached", async () => {
    saveIdentity(user);
    mount(server(new Error("offline")).post);
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
  });

  it("says so, with a way back, when the record no longer replays", async () => {
    saveIdentity(user);
    const m = match();
    const refused: Action = { type: "nextRound" };
    mount(
      server({ ok: true, data: { ...m, log: [{ seat: 2, action: refused, source: "player" }] } })
        .post,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(UNPLAYABLE);
    screen.getByRole("button", { name: "Back to the main screen" }).click();
    await waitFor(() => expect(screen.getByText("main screen")).toBeInTheDocument());
  });
});

describe("a game asked for the moment it ends", () => {
  const missing: Ack<ReplayMatch> = { ok: false, error: NO_SUCH_MATCH };

  it("waits a second and a half, as pinned, before asking again", () => {
    expect(REPLAY_RETRY_MS).toBe(1500);
  });

  it("asks once more after the wait when the record has not landed yet, then plays it", async () => {
    saveIdentity(user);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { post, asked } = answers(missing, { ok: true, data: match() });
    mount(post);
    await act(() => vi.advanceTimersByTimeAsync(REPLAY_RETRY_MS - 1));
    expect(asked).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    expect(await screen.findByText(/Table ABC234 · Oct 1/)).toBeInTheDocument();
    expect(asked).toEqual([
      { path: "/api/users/match", body: { user, id: "m1" } },
      { path: "/api/users/match", body: { user, id: "m1" } },
    ]);
  });

  it("asks twice at most, then says the game is not one of the player's", async () => {
    saveIdentity(user);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { post, asked } = answers(missing);
    mount(post);
    await act(() => vi.advanceTimersByTimeAsync(REPLAY_RETRY_MS * 10));
    vi.useRealTimers();
    expect(await screen.findByRole("alert")).toHaveTextContent("That game is not one of yours.");
    expect(asked).toHaveLength(2);
  });

  it("does not ask again after any other answer", async () => {
    const refused = await loadReplay(
      answers({ ok: false, error: TOO_MANY_REQUESTS }, { ok: true, data: match() }).post,
      user,
      "m1",
      () => Promise.reject(new Error("waited")),
    );
    expect(refused).toEqual({ ok: false, error: TOO_MANY_REQUESTS });
    const found = answers({ ok: true, data: match() });
    await loadReplay(found.post, user, "m1", () => Promise.reject(new Error("waited")));
    expect(found.asked).toHaveLength(1);
  });

  it("never asks again once the page is left during the wait", async () => {
    saveIdentity(user);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { post, asked } = answers(missing, { ok: true, data: match() });
    const { unmount } = render(
      <MemoryRouter initialEntries={["/replay/m1"]}>
        <Routes>
          <Route path="/replay/:matchId" element={<Replay post={post} />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(REPLAY_RETRY_MS * 2));
    expect(asked).toHaveLength(1);
  });
});

describe("going back from a game opened at its table", () => {
  const seat = { roomId: "ABC234", seat: 1, token: "t".repeat(24) };

  it("goes back to the table while this tab still holds a seat there", async () => {
    saveIdentity(user);
    act(() => useSession.getState().seat(seat));
    mount(server({ ok: true, data: match() }).post, "/replay/m1", { table: "ABC234" });
    await screen.findByText(/Table ABC234/);
    act(() => screen.getByRole("button", { name: "Back" }).click());
    expect(await screen.findByText("the table")).toBeInTheDocument();
  });

  it("goes to the main screen once the seat there has gone", async () => {
    saveIdentity(user);
    mount(server({ ok: true, data: match() }).post, "/replay/m1", { table: "ABC234" });
    await screen.findByText(/Table ABC234/);
    act(() => screen.getByRole("button", { name: "Back" }).click());
    expect(await screen.findByText("main screen")).toBeInTheDocument();
  });

  it("goes to the main screen for a seat at another table", async () => {
    saveIdentity(user);
    act(() => useSession.getState().seat({ ...seat, roomId: "XYZ789" }));
    mount(server({ ok: true, data: match() }).post, "/replay/m1", { table: "ABC234" });
    await screen.findByText(/Table ABC234/);
    act(() => screen.getByRole("button", { name: "Back" }).click());
    expect(await screen.findByText("main screen")).toBeInTheDocument();
  });

  it("offers the way back to the table when the game cannot be shown", async () => {
    saveIdentity(user);
    act(() => useSession.getState().seat(seat));
    mount(server(new Error("offline")).post, "/replay/m1", { table: "ABC234" });
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
    act(() => screen.getByRole("button", { name: "Back to the table" }).click());
    expect(await screen.findByText("the table")).toBeInTheDocument();
  });
});

describe("a recorded game as the player's input", () => {
  it("is dealt as it was, from its first seat, with every move, and computers named as such", () => {
    const m = match();
    const timeline = timelineOf(m);
    expect(timeline.length).toBe(m.log.length);
    expect(timeline.stateAt(0).currentSeat).toBe(2);
    expect(timeline.nameOf(2)).toBe("Robo Rita (computer)");
    expect(timeline.nameOf(0)).toBe("Ana");
    expect(timeline.entry(1).seat).toBe(m.log[0]!.seat);
  });
});
