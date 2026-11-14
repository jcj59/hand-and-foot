// The screens that ask the server for a player's history, mounted as the app mounts
// them: with no `post` passed, so they reach the network through their default.
// A default that made a new function on every render once refetched the history
// forever from one open home screen, and used up the Durable Object quota for the day.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MATCHES_PATH } from "@hf/shared";
import { httpPost, IDENTITY_KEY, NAME_KEY, type Post } from "./identity";
import type { HfClientSocket } from "./socket";
import { Home } from "./routes/Home";
import { HistoryPage } from "./pages/HistoryPage";

const stats = {
  played: 4,
  wins: 1,
  unfinished: 0,
  averageScore: 1000,
  bestMatch: 2000,
  bestRound: 900,
  roundsPlayed: 16,
  grabbyPants: 0,
  marvaRules: 0,
  wentOut: 0,
  cleanBooks: 0,
  dirtyBooks: 0,
  pilesTaken: 0,
  redThreesEaten: 0,
  awards: {},
};

/** Every history request `fetch` was asked to make. */
let historyRequests = 0;

beforeEach(() => {
  historyRequests = 0;
  window.localStorage.clear();
  window.localStorage.setItem(NAME_KEY, "Jack");
  window.localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({ userId: "u".repeat(16), secret: "s".repeat(32) }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith(MATCHES_PATH)) historyRequests++;
      return new Response(JSON.stringify({ ok: true, data: { stats, recent: [] } }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Long enough for a refetch loop to have gone round many times. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150));

describe("screens using the default server post", () => {
  it("the home screen asks for the history once, however often it renders", async () => {
    const socket = { emit: () => socket } as unknown as HfClientSocket;
    render(
      <MemoryRouter>
        <Home socket={socket} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Games").nextSibling).toHaveTextContent("4"));
    await settle();
    expect(historyRequests).toBe(1);
  });

  it("a screen that re-renders with a new post every time still asks at most once a minute", async () => {
    // The shape of the bug that spent the quota: an effect keyed on a `post` made
    // afresh on every render. The kept history holds the line even then.
    const socket = { emit: () => socket } as unknown as HfClientSocket;
    const fresh = (): Post => httpPost("");
    const { rerender } = render(
      <MemoryRouter>
        <Home socket={socket} post={fresh()} />
      </MemoryRouter>,
    );
    for (let i = 0; i < 30; i++) {
      rerender(
        <MemoryRouter>
          <Home socket={socket} post={fresh()} />
        </MemoryRouter>,
      );
      await act(async () => {});
    }
    rerender(
      <MemoryRouter>
        <HistoryPage socket={socket} post={fresh()} />
      </MemoryRouter>,
    );
    await settle();
    expect(historyRequests).toBe(1);
  });

  it("the history page asks for the history once", async () => {
    render(
      <MemoryRouter>
        <HistoryPage socket={{ emit: () => undefined } as unknown as HfClientSocket} />
      </MemoryRouter>,
    );
    await settle();
    expect(historyRequests).toBe(1);
  });
});
