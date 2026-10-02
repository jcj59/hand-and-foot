import { describe, it, expect, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Ack, MatchHistory as History, MatchListing } from "@hf/shared";
import { IDENTITY_KEY, saveIdentity, type Post } from "../identity";
import { MatchHistory, outcome } from "./MatchHistory";

/** Rendered inside a router, as on the home screen, since each game links to its replay. */
function render(ui: React.ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

const user = { userId: "u".repeat(16), secret: "s".repeat(32) };

function listing(over: Partial<MatchListing> = {}): MatchListing {
  return {
    id: "m1",
    roomId: "ABC234",
    endedAt: new Date(2026, 9, 1).getTime(),
    rounds: 4,
    roundsPlayed: 4,
    finished: true,
    seat: 0,
    place: 1,
    won: true,
    players: [
      { seat: 0, name: "Ana", total: 2400 },
      { seat: 1, name: "Robo Rita", bot: true, total: 1800 },
      { seat: 2, name: "Ben", total: 2100 },
    ],
    ...over,
  };
}

const stats: History["stats"] = {
  played: 3,
  wins: 2,
  unfinished: 1,
  averageScore: 2150,
  bestMatch: 2400,
  bestRound: 1300,
  roundsPlayed: 13,
  grabbyPants: 4,
  marvaRules: 1,
  wentOut: 5,
  cleanBooks: 9,
  dirtyBooks: 11,
};

/** A server answering the history request, recording what it was asked. */
function server(answer: Ack<History> | Error): { post: Post; asked: unknown[] } {
  const asked: unknown[] = [];
  const post: Post = async (path, body) => {
    asked.push({ path, body });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { post, asked };
}

beforeEach(() => {
  window.localStorage.removeItem(IDENTITY_KEY);
});

describe("the player's games on the home screen", () => {
  it("asks for this browser's identity's history, and shows the stats and recent games", async () => {
    saveIdentity(user);
    const { post, asked } = server({ ok: true, data: { stats, recent: [listing()] } });
    render(<MatchHistory post={post} />);
    const section = await screen.findByRole("region", { name: "Your games" });
    expect(asked).toEqual([{ path: "/api/users/matches", body: { user } }]);
    const tile = (label: string): string =>
      within(section).getByText(label).parentElement!.querySelector("dd")!.textContent!;
    expect(tile("Games")).toBe("3");
    expect(tile("Wins")).toBe("2");
    expect(tile("Average score")).toBe("2150");
    expect(tile("Best round")).toBe("1300");
    expect(tile("Grabby Pants")).toBe("4");
    expect(tile("Marva Rules")).toBe("1");
    expect(section).toHaveTextContent("And 1 unfinished game, counted for rounds but not wins.");
    const game = within(section).getByRole("list", { name: "Recent games" }).firstElementChild!;
    expect(game).toHaveTextContent("Won · 2400");
    // Highest first, with the computer player marked.
    expect(game).toHaveTextContent("Ana 2400 · Ben 2100 · Robo Rita (computer) 1800");
    expect(
      within(game as HTMLElement).getByRole("link", {
        name: /watch the game at table ABC234 again/i,
      }),
    ).toHaveAttribute("href", "/replay/m1");
  });

  it("asks nothing and shows nothing for a browser with no identity", () => {
    const { post, asked } = server({ ok: true, data: { stats, recent: [listing()] } });
    const { container } = render(<MatchHistory post={post} />);
    expect(asked).toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing before the first game, nor when the server refuses or cannot be reached", async () => {
    saveIdentity(user);
    for (const answer of [
      { ok: true as const, data: { stats, recent: [] } },
      { ok: false as const, error: "that is not an identity" },
      new Error("offline"),
    ]) {
      const { post, asked } = server(answer);
      const { container, unmount } = render(<MatchHistory post={post} />);
      await waitFor(() => expect(asked).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("says how each game went in a few words", () => {
    expect(outcome(listing())).toBe("Won · 2400");
    expect(outcome(listing({ won: false, place: 2, seat: 2 }))).toBe("2nd of 3 · 2100");
    expect(outcome(listing({ won: false, place: 3, seat: 1 }))).toBe("3rd of 3 · 1800");
    expect(outcome(listing({ finished: false, roundsPlayed: 2, place: null, won: false }))).toBe(
      "Unfinished · 2 of 4 rounds",
    );
    expect(
      outcome(listing({ finished: false, rounds: 1, roundsPlayed: 0, place: null, won: false })),
    ).toBe("Unfinished · 0 of 1 round");
    const left = listing({
      players: [{ seat: 0, name: "Ana", total: 500, left: true }],
      place: null,
      won: false,
    });
    expect(outcome(left)).toBe("Left · 500");
    const many = listing({
      won: false,
      place: 11,
      players: Array.from({ length: 12 }, (_, seat) => ({ seat, name: `p${seat}`, total: 0 })),
    });
    expect(outcome(many)).toBe("11th of 12 · 0");
    expect(outcome({ ...many, place: 1 })).toBe("1st of 12 · 0");
  });
});
