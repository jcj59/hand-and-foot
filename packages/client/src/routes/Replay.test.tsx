import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EAST_COAST, type Ack, type Action, type GameState, type ReplayMatch } from "@hf/shared";
import { applyAction, deal, heuristicPolicy } from "@hf/engine";
import { IDENTITY_KEY, saveIdentity, type Post } from "../identity";
import { NO_PROFILE, Replay, timelineOf, UNREACHABLE } from "./Replay";

const user = { userId: "u".repeat(16), secret: "s".repeat(32) };

/** Forty real moves of a three-seat game, recorded as the server keeps them. */
function match(): ReplayMatch {
  let state: GameState = deal(3, EAST_COAST, 7, 1, 2);
  const log: { seat: number; action: Action; source: "player" | "bot" }[] = [];
  for (let i = 0; i < 40 && !state.roundEnded; i++) {
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

function mount(post: Post, at = "/replay/m1"): void {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/replay/:matchId" element={<Replay post={post} />} />
        <Route path="/" element={<p>main screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem(IDENTITY_KEY);
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
    expect(screen.getByText(/Step 12 of 40/)).toBeInTheDocument();
  });

  it("says why a browser without the player's profile cannot watch it, and asks nothing", async () => {
    const { post, asked } = server({ ok: true, data: match() });
    mount(post);
    expect(await screen.findByRole("alert")).toHaveTextContent(NO_PROFILE);
    expect(asked).toEqual([]);
  });

  it("shows the server's refusal, and a way back", async () => {
    saveIdentity(user);
    mount(server({ ok: false, error: "that game is not one of yours" }).post);
    expect(await screen.findByRole("alert")).toHaveTextContent("That game is not one of yours.");
    screen.getByRole("button", { name: "Back to the main screen" }).click();
    await waitFor(() => expect(screen.getByText("main screen")).toBeInTheDocument());
  });

  it("says when the server could not be reached", async () => {
    saveIdentity(user);
    mount(server(new Error("offline")).post);
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
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
