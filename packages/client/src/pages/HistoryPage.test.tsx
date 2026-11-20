import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Ack, MatchHistory as History, MatchListing } from "@hf/shared";
import { EAST_COAST } from "@hf/shared";
import { CREDENTIALS_KEY, loadCredentials, saveCredentials } from "../credentials";
import { IDENTITY_KEY, saveIdentity, type Post } from "../identity";
import { forgetHistory } from "../historyCache";
import { loadSavedGames, SAVED_GAMES_KEY, type SavedGame } from "../savedGames";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { day } from "../history/describe";
import { HistoryPage } from "./HistoryPage";

const user = { userId: "u".repeat(16), secret: "s".repeat(32) };
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function listing(over: Partial<MatchListing> = {}): MatchListing {
  return {
    id: "m1",
    roomId: "ABC234",
    endedAt: now - DAY,
    rounds: 4,
    roundsPlayed: 4,
    finished: true,
    seat: 0,
    place: 1,
    won: true,
    preset: "east-coast",
    awards: ["clean"],
    players: [
      { seat: 0, name: "Ana", total: 14320 },
      { seat: 1, name: "Kate", total: 12905 },
      { seat: 2, name: "Mom", total: 9440 },
    ],
    ...over,
  };
}

const second = listing({
  id: "m2",
  roomId: "BCD345",
  endedAt: now - 2 * DAY,
  won: false,
  place: 2,
  preset: "west-coast",
  awards: [],
  players: [
    { seat: 0, name: "Ana", total: 9870 },
    { seat: 1, name: "Sam", total: 11200 },
  ],
});
const unfinished = listing({
  id: "m3",
  roomId: "CDE456",
  endedAt: now - 3 * DAY,
  finished: false,
  roundsPlayed: 2,
  place: null,
  won: false,
  awards: [],
  players: [
    { seat: 0, name: "Ana", total: 4180 },
    { seat: 1, name: "Kate", total: 3990 },
  ],
});
const practice = listing({
  id: "m4",
  roomId: "DEF567",
  endedAt: now - 200 * DAY,
  rounds: 3,
  roundsPlayed: 3,
  awards: ["grabby"],
  players: [
    { seat: 0, name: "Ana", total: 10050 },
    { seat: 1, name: "Robo Rita", bot: true, botLevel: "easy", total: 8800 },
  ],
});

const stats: History["stats"] = {
  played: 42,
  wins: 26,
  unfinished: 1,
  averageScore: 3940,
  bestMatch: 14320,
  bestRound: 6210,
  roundsPlayed: 130,
  grabbyPants: 4,
  marvaRules: 2,
  wentOut: 9,
  cleanBooks: 31,
  dirtyBooks: 11,
  pilesTaken: 57,
  redThreesEaten: 12,
  awards: { grabby: 1, marva: 0, clean: 2, out: 1, pile: 1, "red-threes": 0 },
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

/** A socket answering every request with `answer`, remembering what was sent. */
function fakeSocket(answer: Ack<unknown>): { socket: HfClientSocket; sent: string[] } {
  const sent: string[] = [];
  const socket = {
    emit: (event: string, ...args: unknown[]) => {
      sent.push(event);
      (args[args.length - 1] as (result: Ack<unknown>) => void)(answer);
      return socket;
    },
  } as unknown as HfClientSocket;
  return { socket, sent };
}

function Where(): React.ReactElement {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function render(
  post: Post,
  socket: HfClientSocket = fakeSocket({ ok: true, data: null }).socket,
): ReturnType<typeof rtlRender> {
  return rtlRender(
    <MemoryRouter initialEntries={["/history"]}>
      <Routes>
        <Route path="/history" element={<HistoryPage post={post} socket={socket} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const everything = {
  ok: true as const,
  data: { stats, recent: [listing(), second, unfinished, practice] },
};

/** The cards shown, by their headings. */
function cards(): string[] {
  const list = screen.queryByRole("list", { name: "Recent games" });
  if (!list) return [];
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent!);
}

/**
 * Toggles "only the games with `name`" the way a player does: their face in
 * "Played with" opens their card, whose button shows or stops showing them.
 */
function choose(name: string): void {
  const people = screen.getByRole("group", { name: "Played with" });
  fireEvent.click(within(people).getByRole("button", { name: new RegExp(`^${name}\\b`) }));
  const card = screen.getByRole("dialog", { name });
  fireEvent.click(within(card).getByRole("button", { name: /^(Show our|Stop showing)/ }));
  expect(screen.queryByRole("dialog")).toBeNull();
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  useSession.setState({ credentials: null, room: null, notice: null });
});

afterEach(() => {
  window.localStorage.removeItem(IDENTITY_KEY);
});

describe("the history page", () => {
  it("asks for this browser's history once, and shows the stats and fun counts", async () => {
    saveIdentity(user);
    const { post, asked } = server(everything);
    render(post);
    const tiles = await screen.findByRole("region", { name: "Your stats" });
    expect(asked).toEqual([{ path: "/api/users/matches", body: { user } }]);
    expect(tiles).toHaveTextContent(
      ["Games42", "Wins26", "Average score3,940", "Best round6,210"].join(""),
    );
    expect(screen.getByRole("region", { name: "More stats" })).toHaveTextContent(
      "9 went out31 clean books4 Grabby Pants2 Marva Rules57 piles taken12 red threes eaten",
    );
  });

  it("shows a dash for averages there is nothing to work out from yet", async () => {
    saveIdentity(user);
    const fresh = { ...stats, averageScore: null, bestRound: null };
    render(server({ ok: true, data: { stats: fresh, recent: [unfinished] } }).post);
    const tiles = await screen.findByRole("region", { name: "Your stats" });
    expect(tiles).toHaveTextContent("Average score–");
    expect(tiles).toHaveTextContent("Best round–");
  });

  it("shows each game as a card: how it went, its scores, awards and Watch again", async () => {
    saveIdentity(user);
    render(server(everything).post);
    await screen.findByRole("list", { name: "Recent games" });
    expect(cards()).toEqual(["You won", "2nd of 2", "Unfinished", "You won"]);
    const list = screen.getByRole("list", { name: "Recent games" });
    const first = list.firstElementChild as HTMLElement;
    expect(first).toHaveTextContent("4 rounds · East Coast");
    expect(first).toHaveTextContent("14,320your score");
    const scores = within(first).getByRole("list", { name: "Final scores" });
    expect(
      within(scores)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["You14,320", "Kate12,905", "Mom9,440"]);
    expect(first).toHaveTextContent("Cleanest books");
    expect(
      within(first).getByRole("link", { name: "Watch the game at table ABC234 again" }),
    ).toHaveAttribute("href", "/replay/m1");
    // Second of the two who finished, under the other variant, highest score first.
    const runnerUp = list.children[1] as HTMLElement;
    expect(runnerUp).toHaveTextContent("2nd of 2");
    expect(runnerUp).toHaveTextContent("4 rounds · West Coast");
    expect(
      within(within(runnerUp).getByRole("list", { name: "Final scores" }))
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Sam11,200", "You9,870"]);
    // An unfinished game says where it stopped.
    expect(list.children[2]).toHaveTextContent("Unfinished");
    expect(list.children[2]).toHaveTextContent("stopped after round 2");
  });

  it("tags a practice game, and marks its computers for screen readers", async () => {
    saveIdentity(user);
    render(server(everything).post);
    await screen.findByRole("list", { name: "Recent games" });
    const game = screen.getByRole("list", { name: "Recent games" }).children[3] as HTMLElement;
    expect(game).toHaveTextContent("practice · 3 rounds");
    expect(game).toHaveTextContent("Grabby Pants champion");
    expect(game).toHaveTextContent("Robo Rita (computer)8,800");
  });

  it("filters by place, and says so when nothing is left", async () => {
    saveIdentity(user);
    render(server(everything).post);
    const filters = await screen.findByRole("group", { name: "Filter games" });
    const status = within(filters).getByRole("status");
    expect(status).toHaveTextContent("4 games");
    const place = within(filters).getByRole("group", { name: "Place" });
    expect(within(place).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(place).getByRole("button", { name: "Won" }));
    expect(within(place).getByRole("button", { name: "Won" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(place).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(cards()).toEqual(["You won", "You won"]);
    expect(status).toHaveTextContent("2 games");
    fireEvent.click(within(place).getByRole("button", { name: "Unfinished" }));
    expect(cards()).toEqual(["Unfinished"]);
    expect(status).toHaveTextContent("1 game");
    fireEvent.click(within(place).getByRole("button", { name: "3rd or lower" }));
    expect(cards()).toEqual([]);
    expect(screen.getByText("No games match these filters.")).toBeTruthy();
    expect(status).toHaveTextContent("0 games");
  });

  it("filters by when and by who was there, and sorts", async () => {
    saveIdentity(user);
    render(server(everything).post);
    const filters = await screen.findByRole("group", { name: "Filter games" });
    fireEvent.change(within(filters).getByLabelText("When"), { target: { value: "3m" } });
    expect(cards()).toEqual(["You won", "2nd of 2", "Unfinished"]);
    fireEvent.change(within(filters).getByLabelText("When"), { target: { value: "all" } });

    const people = within(filters).getByRole("group", { name: "Played with" });
    // People only, the most played with first: never the computer.
    expect(
      within(people)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Kate", "Mom", "Sam"]);
    choose("Kate");
    expect(within(people).getByRole("button", { name: /^Kate, only your games/ })).toBeTruthy();
    expect(cards()).toEqual(["You won", "Unfinished"]);
    expect(within(filters).getByRole("status")).toHaveTextContent("2 games with Kate");
    choose("Mom");
    expect(cards()).toEqual(["You won"]);
    expect(within(filters).getByRole("status")).toHaveTextContent("1 game with Kate and Mom");
    choose("Kate");
    choose("Mom");
    expect(within(people).getByRole("button", { name: "Kate" })).toBeTruthy();
    expect(cards()).toHaveLength(4);

    fireEvent.change(within(filters).getByLabelText("Sort by"), { target: { value: "low" } });
    expect(
      [...screen.getByRole("list", { name: "Recent games" }).children].map(
        (c) => c.querySelector(".text-right .font-display")!.textContent,
      ),
    ).toEqual(["4,180", "9,870", "10,050", "14,320"]);
  });

  it("offers Resume on an unfinished game this device still has saved, and picks it back up", async () => {
    saveIdentity(user);
    window.localStorage.setItem(
      SAVED_GAMES_KEY,
      JSON.stringify([
        { roomId: "CDE456", seat: 0, token: "t", savedUntil: now + DAY, names: ["Ana"], round: 3 },
        // Saved once, but long past keeping: nothing to resume.
        { roomId: "ABC234", seat: 0, token: "t", savedUntil: now - DAY, names: ["Ana"], round: 2 },
      ]),
    );
    const { socket, sent } = fakeSocket({
      ok: true,
      data: { roomId: "CDE456", seat: 0, token: "t" },
    });
    render(server(everything).post, socket);
    const resume = await screen.findByRole("button", { name: "Resume the game at table CDE456" });
    expect(resume).toHaveTextContent("Resume");
    expect(screen.getAllByRole("link", { name: /^Watch the game/ })).toHaveLength(3);
    // On record already, so not repeated as a game in progress.
    expect(screen.queryByRole("list", { name: "Games in progress" })).toBeNull();
    fireEvent.click(resume);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/room/CDE456"));
    expect(sent).toEqual(["resumeSeat"]);
  });

  it("says why a saved game could not be resumed, and offers its replay instead", async () => {
    saveIdentity(user);
    window.localStorage.setItem(
      SAVED_GAMES_KEY,
      JSON.stringify([
        { roomId: "CDE456", seat: 0, token: "t", savedUntil: now + DAY, names: ["Ana"], round: 3 },
      ]),
    );
    const { socket } = fakeSocket({ ok: false, error: "no room with that code" });
    render(server(everything).post, socket);
    fireEvent.click(await screen.findByRole("button", { name: "Resume the game at table CDE456" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Watch the game at table CDE456 again" }),
      ).toHaveAttribute("href", "/replay/m3"),
    );
  });

  it("says there are no games yet for a browser that has never played, without asking", async () => {
    const { post, asked } = server(everything);
    render(post);
    expect(screen.getByText("No games yet.")).toBeTruthy();
    await act(async () => {});
    expect(asked).toEqual([]);
  });

  it("says there are no games yet once the server answers with none", async () => {
    saveIdentity(user);
    render(server({ ok: true, data: { stats, recent: [] } }).post);
    expect(await screen.findByText("No games yet.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your stats" })).toBeNull();
  });

  it("shows nothing more than its title when the server refuses or cannot be reached", async () => {
    saveIdentity(user);
    for (const answer of [
      { ok: false as const, error: "that is not an identity" },
      new Error("offline"),
    ]) {
      // A failed answer is kept for a minute too; each case asks afresh.
      forgetHistory();
      const { post, asked } = server(answer);
      const { unmount } = render(post);
      await waitFor(() => expect(asked).toHaveLength(1));
      await act(async () => {});
      expect(screen.getByRole("heading", { name: "History" })).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Your stats" })).toBeNull();
      expect(screen.queryByText("No games yet.")).toBeNull();
      unmount();
    }
  });
});

/** A saved game, kept for a day from now unless told otherwise. */
function savedGame(over: Partial<SavedGame> = {}): SavedGame {
  return {
    roomId: "SAV234",
    seat: 0,
    token: "saved-token",
    savedUntil: now + DAY,
    names: ["Ana", "Kate", "Mom"],
    round: 2,
    ...over,
  };
}

function keepSaved(...games: SavedGame[]): void {
  window.localStorage.setItem(SAVED_GAMES_KEY, JSON.stringify(games));
}

const held = { roomId: "HLD234", seat: 1, token: "held-token" };

/** The games in progress shown, by their headings and the line under each. */
function inProgress(): string[] {
  const list = screen.queryByRole("list", { name: "Games in progress" });
  if (!list) return [];
  return [...list.children].map(
    (card) =>
      `${card.querySelector("h3")!.textContent} | ${card.querySelector("h3 + span")!.textContent}`,
  );
}

describe("people you have played with", () => {
  it("names each face in Played with by first name, with the full name to hover", async () => {
    saveIdentity(user);
    const named = listing({
      players: [
        { seat: 0, name: "Ana", total: 100 },
        { seat: 1, name: "Aunt May", total: 50 },
      ],
    });
    render(server({ ok: true, data: { stats, recent: [named, ...everything.data.recent] } }).post);
    const people = await screen.findByRole("group", { name: "Played with" });
    const faces = within(people).getAllByRole("button");
    expect(faces.map((b) => b.textContent)).toEqual(["Kate", "Aunt", "Mom", "Sam"]);
    expect(faces[1]).toHaveAttribute("title", "Aunt May");
    expect(faces[1]).toHaveAttribute("aria-label", "Aunt May");
    // Six faces fit, so there is no More.
    expect(within(people).queryByRole("button", { name: /Everyone/ })).toBeNull();
  });

  it("opens a person's card from their face, with what your games together say", async () => {
    saveIdentity(user);
    render(server(everything).post);
    const people = await screen.findByRole("group", { name: "Played with" });
    fireEvent.click(within(people).getByRole("button", { name: "Kate" }));
    const card = screen.getByRole("dialog", { name: "Kate" });
    expect(card).toHaveTextContent(`2 games togetherLast played ${day(now - DAY)}`);
    expect(card).toHaveTextContent("From your games together");
    // The unfinished game counts as a game together, not toward wins or scores.
    const rows = within(card)
      .getAllByRole("row")
      .map((row) => [...row.querySelectorAll("th, td")].map((c) => c.textContent));
    expect(rows).toEqual([
      ["Stat", "Kate", "You"],
      ["Wins", "0", "1"],
      ["Average score", "12,905", "14,320"],
      ["Best score", "12,905", "14,320"],
    ]);
    // Closing changes nothing.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cards()).toHaveLength(4);
  });

  it("opens a person's card from their name on a game, never a computer's or your own", async () => {
    saveIdentity(user);
    render(server(everything).post);
    const list = await screen.findByRole("list", { name: "Recent games" });
    const [won, second, , practice] = [...list.children] as HTMLElement[];
    expect(within(practice!).queryAllByRole("button")).toEqual([]);
    expect(
      within(within(won!).getByRole("list", { name: "Final scores" }))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Kate", "Mom"]);
    fireEvent.click(within(second!).getByRole("button", { name: "Sam" }));
    const card = screen.getByRole("dialog", { name: "Sam" });
    expect(card).toHaveTextContent("1 game together");
    fireEvent.click(within(card).getByRole("button", { name: "Show our 1 game" }));
    expect(cards()).toEqual(["2nd of 2"]);
    expect(screen.getByRole("status")).toHaveTextContent("1 game with Sam");
  });

  it("lists everyone under More, and keeps a chosen face in the row", async () => {
    saveIdentity(user);
    const names = ["Abe", "Bea", "Cal", "Dot", "Eve", "Fay", "Gus", "Hal"];
    const recent = names.map((name, i) =>
      listing({
        id: `p${i}`,
        players: [
          { seat: 0, name: "Ana", total: 100 },
          { seat: 1, name, total: 50 },
        ],
      }),
    );
    render(server({ ok: true, data: { stats, recent } }).post);
    const people = await screen.findByRole("group", { name: "Played with" });
    const faces = (): string[] =>
      within(people)
        .getAllByRole("button")
        .map((b) => b.textContent!);
    expect(faces()).toEqual([...names.slice(0, 6), "+2More"]);

    fireEvent.click(
      within(people).getByRole("button", { name: "Everyone you have played with (2 more)" }),
    );
    const more = screen.getByRole("dialog", { name: "Played with" });
    const everyone = within(more).getByRole("list", { name: "Everyone you have played with" });
    expect(
      within(everyone)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(names.map((n) => `${n}1 game together`));
    fireEvent.click(within(everyone).getByRole("button", { name: /^Hal/ }));
    expect(screen.queryByRole("dialog", { name: "Played with" })).toBeNull();
    const hal = screen.getByRole("dialog", { name: "Hal" });
    fireEvent.click(within(hal).getByRole("button", { name: "Show our 1 game" }));
    expect(cards()).toHaveLength(1);
    expect(faces()).toEqual([...names.slice(0, 6), "Hal", "+1More"]);

    fireEvent.click(within(people).getByRole("button", { name: /Everyone/ }));
    expect(
      within(screen.getByRole("dialog", { name: "Played with" })).getByRole("button", {
        name: /^Hal/,
      }),
    ).toHaveTextContent("1 game together · shown");
  });
});

describe("games in progress", () => {
  it("shows the held seat and each saved game above the recent games, from this device alone", async () => {
    saveIdentity(user);
    saveCredentials(held);
    keepSaved(
      savedGame(),
      // Long past keeping: its table has closed.
      savedGame({ roomId: "OLD234", savedUntil: now - DAY }),
    );
    const { post, asked } = server(everything);
    const { socket, sent } = fakeSocket({ ok: true, data: null });
    render(post, socket);
    await screen.findByRole("list", { name: "Recent games" });
    expect(inProgress()).toEqual([
      "In progress | Table HLD234 · your seat is waiting",
      `Saved for later | Table SAV234 · kept until ${new Date(now + DAY).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    ]);
    const group = screen.getByRole("heading", { name: "In progress", level: 2 });
    expect(
      group.compareDocumentPosition(screen.getByRole("heading", { name: "Recent games" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const [heldCard, savedCard] = [
      ...screen.getByRole("list", { name: "Games in progress" }).children,
    ] as HTMLElement[];
    expect(heldCard).toHaveTextContent("You still have a seat at this table.");
    expect(
      within(within(savedCard!).getByRole("list", { name: "At the table" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["You", "Kate", "Mom"]);
    expect(savedCard).toHaveTextContent(/2\s*round/);
    // The only request is the history's own; nothing is asked of the table.
    expect(asked).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("rejoins the held seat by going to its table, as Home's Rejoin does", async () => {
    saveIdentity(user);
    saveCredentials(held);
    const { socket, sent } = fakeSocket({ ok: true, data: null });
    render(server(everything).post, socket);
    fireEvent.click(await screen.findByRole("button", { name: "Rejoin the game at table HLD234" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/room/HLD234");
    expect(sent).toEqual([]);
  });

  it("names who sits at the held table when this tab is at it, and marks computers", async () => {
    saveIdentity(user);
    useSession.setState({
      credentials: held,
      room: {
        roomId: "HLD234",
        players: [
          { seat: 0, name: "Dad", connected: true },
          { seat: 1, name: "Ana", connected: true },
          { seat: 2, name: "Robo", connected: true, bot: true, botLevel: "hard" },
        ],
        hostSeat: 0,
        started: true,
        config: EAST_COAST,
        playAgain: [],
        nextRoundReady: [],
      },
    });
    render(server(everything).post);
    const card = (await screen.findByRole("list", { name: "Games in progress" })).children[0]!;
    expect(
      within(within(card as HTMLElement).getByRole("list", { name: "At the table" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Dad", "You", "Robo (computer)"]);
  });

  it("resumes a saved game with its own seat, and goes to the table", async () => {
    saveIdentity(user);
    keepSaved(savedGame());
    const { socket, sent } = fakeSocket({
      ok: true,
      data: { roomId: "SAV234", seat: 0, token: "saved-token" },
    });
    render(server(everything).post, socket);
    fireEvent.click(await screen.findByRole("button", { name: "Resume the game at table SAV234" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/room/SAV234"));
    expect(sent).toEqual(["resumeSeat"]);
  });

  it("forgets only the saved game that could not be resumed, never the held seat", async () => {
    saveIdentity(user);
    saveCredentials(held);
    keepSaved(savedGame(), savedGame({ roomId: "TWO234", names: ["Ana", "Sam"] }));
    const { socket } = fakeSocket({ ok: false, error: "no room with that code" });
    render(server(everything).post, socket);
    fireEvent.click(await screen.findByRole("button", { name: "Resume the game at table SAV234" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect(inProgress()).toHaveLength(2));
    expect(inProgress().map((line) => line.split(" | ")[1]!.slice(0, 12))).toEqual([
      "Table HLD234",
      "Table TWO234",
    ]);
    expect(loadSavedGames().map((g) => g.roomId)).toEqual(["TWO234"]);
    expect(loadCredentials()).toEqual(held);
    expect(window.localStorage.getItem(CREDENTIALS_KEY)).not.toBeNull();
  });

  it("shows under All and Unfinished, and only with people known to be at the table", async () => {
    saveIdentity(user);
    saveCredentials(held);
    keepSaved(savedGame(), savedGame({ roomId: "TWO234", names: ["Ana", "Sam"] }));
    render(server(everything).post);
    await screen.findByRole("list", { name: "Recent games" });
    const place = (name: string) =>
      fireEvent.click(
        within(screen.getByRole("group", { name: "Place" })).getByRole("button", { name }),
      );
    expect(inProgress()).toHaveLength(3);
    for (const name of ["Won", "2nd", "3rd or lower"]) {
      place(name);
      expect(inProgress()).toEqual([]);
      expect(screen.queryByRole("heading", { name: "In progress", level: 2 })).toBeNull();
    }
    place("Unfinished");
    expect(inProgress()).toHaveLength(3);
    place("All");
    choose("Kate");
    // Kate is at SAV234; who sits at the held table is not known here.
    expect(inProgress().map((line) => line.split(" | ")[1]!.slice(0, 12))).toEqual([
      "Table SAV234",
    ]);
  });

  it("shows games in progress to a browser with no finished games, or no server", async () => {
    keepSaved(savedGame());
    const { post, asked } = server(everything);
    const first = render(post);
    expect(inProgress()).toHaveLength(1);
    expect(screen.getByText("No finished games yet.")).toBeTruthy();
    expect(asked).toEqual([]);
    first.unmount();

    saveIdentity(user);
    forgetHistory();
    const second = render(server({ ok: true, data: { stats, recent: [] } }).post);
    expect(await screen.findByText("No finished games yet.")).toBeTruthy();
    expect(inProgress()).toHaveLength(1);
    second.unmount();

    forgetHistory();
    const offline = server(new Error("offline"));
    render(offline.post);
    await waitFor(() => expect(inProgress()).toHaveLength(1));
    expect(screen.queryByText(/games yet/)).toBeNull();
  });

  it("waits for the history before showing games in progress, so none jumps", async () => {
    saveIdentity(user);
    keepSaved(savedGame());
    let answer: (value: Ack<History>) => void = () => {};
    render(() => new Promise((resolve) => (answer = resolve)));
    await act(async () => {});
    expect(inProgress()).toEqual([]);
    await act(async () => answer(everything));
    expect(inProgress()).toHaveLength(1);
  });
});
