import { describe, it, expect, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Ack } from "@hf/shared";
import { CREDENTIALS_KEY } from "../credentials";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { ACCOUNT_KEY, IDENTITY_KEY, NAME_KEY, type Post } from "../identity";
import { RULES_KEY } from "../rules/customRules";
import { AVATAR_KEY } from "../profile/avatarStore";
import { Home, partOfDay } from "./Home";
import { suggestBotName } from "../home/sheets";
import { PRACTICE_KEY } from "../home/practiceStore";

/** A socket that answers each request from a queue and records what was sent. */
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
      ack(queue.shift() ?? { ok: true, data: { roomId: "ABC234", seat: 0, token: "t" } });
      return socket;
    },
  } as unknown as HfClientSocket;
  return { socket, sent };
}

/** Render at a path, capturing where the app navigates to. */
/** An identity server that accepts everything, and remembers what it was sent. */
function fakeUsers(answer: Ack<unknown> = { ok: true, data: {} }): Post & { sent: unknown[] } {
  const sent: unknown[] = [];
  const post = (async (_path: string, body: unknown) => {
    sent.push(body);
    return answer;
  }) as Post & { sent: unknown[] };
  post.sent = sent;
  return post;
}

function mount(
  socket: HfClientSocket,
  path = "/",
  post: Post = fakeUsers(),
): { readonly landed: () => string | null } {
  let landed: string | null = null;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home socket={socket} post={post} />} />
        <Route path="/room/:roomId" element={<Home socket={socket} post={post} />} />
        <Route path="/practice" element={<Home socket={socket} post={post} />} />
      </Routes>
      <Landing onRender={(p) => (landed = p)} />
    </MemoryRouter>,
  );
  return { landed: () => landed };
}

/** Reports the current location, so a navigation is observable. */
function Landing({ onRender }: { readonly onRender: (path: string) => void }): null {
  onRender(useLocation().pathname);
  return null;
}

/** The sheet open now, by which one it is (`data-sheet`), whatever step it is at. */
const sheetNow = (): HTMLElement | null => document.querySelector<HTMLElement>("[data-sheet]");

/** Open a sheet from the banner, unless it is open already. */
function opened(which: "new" | "join"): HTMLElement {
  const open = sheetNow();
  if (open?.dataset.sheet === which) return open;
  fireEvent.click(
    screen.getByRole("button", { name: which === "new" ? "New table" : /join with code/i }),
  );
  return sheetNow()!;
}
const openNew = (): HTMLElement => opened("new");
const openJoin = (): HTMLElement => opened("join");

/** The New table sheet at one of its steps: the table, its house rules, your card. */
function newStep(step: "rules" | "house" | "card"): HTMLElement {
  let sheet = openNew();
  const title = (): string | null => sheetNow()!.getAttribute("aria-label");
  if (title() === "House rules") fireEvent.click(within(sheet).getByText("Back to the table"));
  if (title() === "Your player card")
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
  sheet = sheetNow()!;
  if (step === "house")
    fireEvent.click(within(sheet).getByRole("button", { name: /house rules/i }));
  if (step === "card") {
    const next = within(sheet).getByRole("button", { name: "Open table" });
    if (!(next as HTMLButtonElement).disabled) fireEvent.click(next);
  }
  return sheetNow()!;
}

/** The Join sheet at its code step, or past it at your card if the code allows. */
function joinStep(step: "code" | "card"): HTMLElement {
  const sheet = openJoin();
  const back = within(sheet).queryByRole("button", { name: "Back" });
  if (step === "code" && back) fireEvent.click(back);
  if (step === "card" && !back) {
    const next = within(sheetNow()!).getByRole("button", { name: "Continue" });
    if (!(next as HTMLButtonElement).disabled) fireEvent.click(next);
  }
  return sheetNow()!;
}

/** The name on your card, in whichever sheet is open (New table's if neither). */
const nameBox = (): HTMLElement => {
  const open = sheetNow();
  const here = open && within(open).queryByLabelText(/your name/i);
  if (here) return here;
  if (open?.dataset.sheet === "join") {
    const card = within(joinStep("card")).queryByLabelText(/your name/i);
    if (card) return card;
  }
  return within(newStep("card")).getByLabelText(/your name/i);
};
const codeBox = (): HTMLElement => within(joinStep("code")).getByLabelText(/table code/i);
/** Take a seat once the code is in; while it is not yet one, the (disabled) Continue. */
const joinButton = (): HTMLElement => {
  const sheet = joinStep("card");
  return (
    within(sheet).queryByRole("button", { name: /take a seat/i }) ??
    within(sheet).getByRole("button", { name: "Continue" })
  );
};
/** Open table on your card, or, while the rules would be refused, the (disabled) one before it. */
const createButton = (): HTMLElement =>
  within(newStep("card")).getByRole("button", { name: "Open table" });
/** Choose an option of one of the New table sheet's choices (Variant, Mode). */
const pick = (option: RegExp | string): void => {
  fireEvent.click(within(newStep("rules")).getByRole("radio", { name: option }));
};
const chosen = (option: RegExp | string): boolean =>
  (within(newStep("rules")).getByRole("radio", { name: option }) as HTMLInputElement).checked;

beforeEach(() => {
  window.localStorage.removeItem(CREDENTIALS_KEY);
  window.localStorage.removeItem(NAME_KEY);
  window.localStorage.removeItem(IDENTITY_KEY);
  window.localStorage.removeItem(ACCOUNT_KEY);
  window.localStorage.removeItem(RULES_KEY);
  window.localStorage.removeItem(AVATAR_KEY);
  window.localStorage.removeItem(PRACTICE_KEY);
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

describe("before a name is given", () => {
  it("offers neither action", () => {
    // Every seat is shown by name at the table, so there is nothing sensible to
    // send without one.
    mount(fakeSocket().socket);
    expect(createButton()).toBeDisabled();
    expect(joinButton()).toBeDisabled();
  });

  it("still refuses to join once a name is typed but the code is not a code", () => {
    mount(fakeSocket().socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.change(codeBox(), { target: { value: "ABC" } });
    expect(joinButton()).toBeDisabled();
    // Creating needs no code, so it is available.
    expect(createButton()).not.toBeDisabled();
  });
});

describe("opening a table", () => {
  it("sends the name and the chosen rules", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    pick(/West Coast/);
    pick(/Competitive/);
    fireEvent.click(createButton());

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      event: "createRoom",
      args: [
        {
          name: "ana",
          options: { preset: "west-coast", mode: "competitive", rules: {} },
          user: JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!),
        },
      ],
    });
  });

  it("sends the picture chosen here, keeps it for next time, and sends none until one is", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    // Not chosen: nothing sent, and every screen draws a face from the name.
    expect(sent[0]!.args[0]).not.toHaveProperty("avatar");

    // On the card: the parts, one by one.
    fireEvent.click(within(newStep("card")).getByRole("button", { name: "Choose each part" }));
    fireEvent.click(screen.getByRole("button", { name: "Hair or hat: crown" }));
    const chosen = JSON.parse(window.localStorage.getItem(AVATAR_KEY)!);
    expect(chosen.top).toBe("crown");
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect((sent[1]!.args[0] as { avatar: unknown }).avatar).toEqual(chosen);
  });

  it("defaults to the East Coast family game", async () => {
    // The variant this was built for; omitting the choice should mean that.
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].args[0]).toMatchObject({
      options: { preset: "east-coast", mode: "family" },
    });
  });

  it("takes the seat the server grants", async () => {
    const { socket } = fakeSocket([
      { ok: true, data: { roomId: "ZZZ999", seat: 0, token: "tok" } },
    ]);
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(useSession.getState().credentials).toEqual({
        roomId: "ZZZ999",
        seat: 0,
        token: "tok",
      }),
    );
  });
});

describe("joining a table", () => {
  it("forgives case and separators in the code", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ben" } });
    fireEvent.change(codeBox(), { target: { value: "abc-234" } });
    expect(joinButton()).not.toBeDisabled();
    fireEvent.click(joinButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      event: "joinRoom",
      args: [
        {
          roomId: "ABC234",
          name: "ben",
          user: JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!),
        },
      ],
    });
  });

  it("leaves room in the code box for a typed or pasted separator", () => {
    // A browser truncates to maxlength before any change handler runs, and
    // fireEvent.change bypasses that, so the limit itself is what is pinned: a
    // box that only fits six characters turns a pasted "ABC-234" into "ABC23".
    mount(fakeSocket().socket);
    expect((codeBox() as HTMLInputElement).maxLength).toBeGreaterThanOrEqual("ABC-234".length);
    expect((codeBox() as HTMLInputElement).maxLength).toBeGreaterThanOrEqual("A B C 2 3 4".length);
  });

  it("fills in the code when arriving from a shared link", () => {
    // The common case: the code is already known and only a name is missing.
    mount(fakeSocket().socket, "/room/abc234");
    // Straight past the code, which the link gave, to who is sitting down.
    const sheet = screen.getByRole("dialog", { name: "Your player card" });
    expect(sheet).toHaveTextContent("Joining");
    expect(sheet).toHaveTextContent("Table ABC234");
    expect(screen.getByText(/invited to a table/i)).not.toBeNull();
    // The name is the only thing missing, so the cursor goes there.
    expect(nameBox()).toHaveFocus();
    expect(codeBox()).toHaveValue("ABC234");
  });

  it("starts with the name field focused on a plain visit too", () => {
    // A name comes first whichever way the player then goes.
    mount(fakeSocket().socket);
    expect(nameBox()).toHaveFocus();
  });

  it("shows the server's reason when the table is not there", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "no room with that code" }]);
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ben" } });
    fireEvent.change(codeBox(), { target: { value: "ABC234" } });
    fireEvent.click(joinButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/no room/i));
  });

  it("lets a wrong code be corrected and retried", async () => {
    // The busy flag has to clear on refusal too, or the player is stuck looking at
    // the error with a dead button.
    const { socket, sent } = fakeSocket([
      { ok: false, error: "no room with that code" },
      { ok: true, data: { roomId: "ABC234", seat: 1, token: "t" } },
    ]);
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ben" } });
    fireEvent.change(codeBox(), { target: { value: "ZZZ999" } });
    fireEvent.click(joinButton());
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());

    fireEvent.change(codeBox(), { target: { value: "ABC234" } });
    expect(joinButton()).not.toBeDisabled();
    fireEvent.click(joinButton());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(useSession.getState().credentials?.seat).toBe(1);
  });
});

describe("a seat this tab still holds", () => {
  it("offers the way back to it", () => {
    useSession.setState({ credentials: { roomId: "ABC234", seat: 0, token: "t" } });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home socket={fakeHomeSocket()} post={fakeUsers()} />} />
          <Route path="/room/:roomId" element={<p>at the table</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/your table/i)).toHaveTextContent("table ABC234");
    fireEvent.click(screen.getByRole("button", { name: /rejoin/i }));
    expect(screen.getByText("at the table")).toBeInTheDocument();
  });

  it("says nothing when there is no seat", () => {
    useSession.setState({ credentials: null });
    render(
      <MemoryRouter>
        <Home socket={fakeHomeSocket()} post={fakeUsers()} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/your table/i)).toBeNull();
  });
});

function fakeHomeSocket(): HfClientSocket {
  const socket = { emit: () => socket } as unknown as HfClientSocket;
  return socket;
}

describe("who is sitting down", () => {
  it("offers the name used last time, and remembers a new one", async () => {
    window.localStorage.setItem(NAME_KEY, "Ana");
    const { socket } = fakeSocket();
    mount(socket);
    expect(nameBox()).toHaveValue("Ana");
    fireEvent.change(nameBox(), { target: { value: "Annie" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(window.localStorage.getItem(NAME_KEY)).toBe("Annie"));
  });

  it("registers this browser's identity under the name, and sits down with it", async () => {
    const { socket, sent } = fakeSocket();
    const users = fakeUsers();
    mount(socket, "/", users);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    const identity = JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!);
    expect(users.sent).toEqual([{ ...identity, name: "ana" }]);
    expect(sent[0]!.args[0]).toMatchObject({ name: "ana", user: identity });
  });

  it("sits down without one when the server will not register it", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket, "/", fakeUsers({ ok: false, error: "no" }));
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.change(codeBox(), { target: { value: "ABC234" } });
    fireEvent.click(joinButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.args[0]).not.toHaveProperty("user");
  });
});

describe("the scenario viewer", () => {
  it("is a link from the home screen in a development build", () => {
    mount(fakeSocket().socket);
    expect(screen.getByRole("link", { name: /scenario viewer/i })).toHaveAttribute(
      "href",
      "/scenarios",
    );
  });
});

describe("changing the rules", () => {
  const field = (label: string): HTMLInputElement => within(newStep("house")).getByLabelText(label);
  const sentOptions = (sent: { args: unknown[] }[]): unknown =>
    (sent[0]!.args[0] as { options: unknown }).options;

  it("sends only what was changed, on top of the preset and mode", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.change(field("Hand"), { target: { value: "11" } });
    fireEvent.click(field("Marva rule"));
    fireEvent.change(field("Red three"), { target: { value: "-300" } });
    fireEvent.change(field("Time per turn"), { target: { value: "45" } });
    expect(screen.getByText("4 changed")).toBeInTheDocument();
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sentOptions(sent)).toEqual({
      preset: "east-coast",
      mode: "family",
      rules: {
        handSize: 11,
        marvaRule: false,
        scoring: { redThree: -300 },
        timers: { baseMs: 45_000 },
      },
    });
  });

  it("has a control for every rule, each changing that rule and no other", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    const type = (label: string, value: string): void => {
      fireEvent.change(field(label), { target: { value } });
    };
    type("Rounds", "3");
    type("Round 3 minimum", "125");
    fireEvent.change(field("Wild cards in a meld"), { target: { value: "naturals-equal-wilds" } });
    fireEvent.click(field("Marva rule"));
    type("Clean books to go out", "2");
    type("Dirty books to go out", "3");
    type("Hand", "13");
    type("Foot", "12");
    type("Extra decks", "2");
    fireEvent.click(field("First discard turned up"));
    fireEvent.change(field("When the stock runs out"), { target: { value: "end" } });
    for (const [label, value] of [
      ["Joker", "45"],
      ["Two", "25"],
      ["Ace", "20"],
      ["Ten to king", "15"],
      ["Four to nine", "10"],
      ["Black three", "0"],
      ["Red three", "-400"],
      ["Clean book bonus", "600"],
      ["Dirty book bonus", "250"],
      ["Going out bonus", "200"],
      ["Time per turn", "60"],
      ["Added per move", "5"],
      ["Longest turn", "240"],
      ["Time to discard after", "30"],
    ] as const) {
      type(label, value);
    }
    fireEvent.click(field("Pausing allowed"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sentOptions(sent)).toEqual({
      preset: "east-coast",
      mode: "family",
      rules: {
        rounds: 3,
        layDownMinimums: [60, 90, 125],
        wildRatio: "naturals-equal-wilds",
        marvaRule: false,
        goOutCleanBooks: 2,
        goOutDirtyBooks: 3,
        handSize: 13,
        footSize: 12,
        extraDecks: 2,
        initialDiscardFlip: false,
        stockExhaustion: "end",
        pauseEnabled: false,
        scoring: {
          joker: 45,
          two: 25,
          ace: 20,
          tenToKing: 15,
          fourToNine: 10,
          blackThree: 0,
          redThree: -400,
          cleanBookBonus: 600,
          dirtyBookBonus: 250,
          goOutBonus: 200,
        },
        timers: { baseMs: 60_000, incrementMs: 5_000, capMs: 240_000, discardGraceMs: 30_000 },
      },
    });
  }, 20_000);

  it("marks a changed rule with the preset's value, and un-marks it when set back", () => {
    mount(fakeSocket().socket);
    const row = (): HTMLElement => field("Foot").closest("div[class*='rounded']") as HTMLElement;
    fireEvent.change(field("Foot"), { target: { value: "12" } });
    expect(row()).toHaveAttribute("data-changed");
    expect(row()).toHaveTextContent("Preset: 14 cards");
    fireEvent.change(field("Foot"), { target: { value: "14" } });
    expect(row()).not.toHaveAttribute("data-changed");
    expect(screen.queryByText(/changed$/)).toBeNull();
  });

  it("says why rules cannot be dealt, and will not open the table until they can", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.change(field("Hand"), { target: { value: "40" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The hand size must be between 5 and 20.");
    expect(createButton()).toBeDisabled();
    fireEvent.change(field("Hand"), { target: { value: "" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The hand size must be a whole number.");
    fireEvent.change(field("Hand"), { target: { value: "20" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("gives a minimum for each round as the number of rounds changes", () => {
    mount(fakeSocket().socket);
    fireEvent.change(field("Rounds"), { target: { value: "2" } });
    expect(screen.queryByLabelText("Round 3 minimum")).toBeNull();
    fireEvent.change(field("Round 2 minimum"), { target: { value: "100" } });
    fireEvent.change(field("Rounds"), { target: { value: "6" } });
    expect(
      ["Round 1", "Round 2", "Round 3", "Round 4", "Round 5", "Round 6"].map(
        (r) => field(`${r} minimum`).value,
      ),
    ).toEqual(["60", "100", "120", "150", "180", "210"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("will not allow pausing a competitive table", () => {
    mount(fakeSocket().socket);
    pick(/Competitive/);
    expect(field("Pausing allowed").checked).toBe(false);
    fireEvent.click(field("Pausing allowed"));
    expect(screen.getByRole("alert")).toHaveTextContent(/competitive table cannot be paused/);
    expect(createButton()).toBeDisabled();
  });

  it("keeps the changes when the variant changes, and can go back to the preset", () => {
    mount(fakeSocket().socket);
    fireEvent.change(field("Hand"), { target: { value: "11" } });
    pick(/West Coast/);
    expect(field("Hand").value).toBe("11");
    expect(screen.getByLabelText<HTMLSelectElement>("Wild cards in a meld").value).toBe(
      "naturals-equal-wilds",
    );
    fireEvent.click(screen.getByRole("button", { name: /back to the preset/i }));
    expect(field("Hand").value).toBe("14");
    expect(chosen(/West Coast/)).toBe(true);
  });

  it("remembers the last rules a table was opened with, on this device", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    pick(/West Coast/);
    fireEvent.change(field("Foot"), { target: { value: "9" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    cleanup();

    mount(fakeSocket().socket);
    expect(chosen(/West Coast/)).toBe(true);
    expect(field("Foot").value).toBe("9");
  });

  it("does not remember rules from a table that was refused", async () => {
    const { socket, sent } = fakeSocket([{ ok: false, error: "no" }]);
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.change(field("Foot"), { target: { value: "9" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(window.localStorage.getItem(RULES_KEY)).toBeNull();
  });
});

describe("the home screen's own parts", () => {
  it("greets the player by name and part of day, with their record once the server answers", async () => {
    window.localStorage.setItem(NAME_KEY, "Jack");
    window.localStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ userId: "u".repeat(16), secret: "s".repeat(32) }),
    );
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
      awards: { grabby: 2, clean: 1 },
    };
    mount(fakeSocket().socket, "/", fakeUsers({ ok: true, data: { stats, recent: [] } }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /^(Morning|Afternoon|Evening), Jack$/,
    );
    await waitFor(() => expect(screen.getByText("Won").nextSibling).toHaveTextContent("25%"));
    expect(screen.getByText("Games").nextSibling).toHaveTextContent("4");
    expect(screen.getByText("Awards").nextSibling).toHaveTextContent("3");
  });

  it("says morning, afternoon or evening by the hour", () => {
    expect([0, 11, 12, 17, 18, 23].map(partOfDay)).toEqual([
      "Morning",
      "Morning",
      "Afternoon",
      "Afternoon",
      "Evening",
      "Evening",
    ]);
  });

  it("leads to learning and the demo, and to practice", () => {
    mount(fakeSocket().socket);
    const tiles = screen.getByRole("region", { name: "Quick start" });
    expect(within(tiles).getByRole("link", { name: /learn in 5 minutes/i })).toHaveAttribute(
      "href",
      "/learn",
    );
    expect(within(tiles).getByRole("link", { name: /watch a demo game/i })).toHaveAttribute(
      "href",
      "/learn/demo",
    );
    fireEvent.click(within(tiles).getByRole("button", { name: /practice vs computers/i }));
    expect(screen.getByRole("dialog", { name: "Practice" })).toBeInTheDocument();
  });

  it("closes a sheet without sitting down", () => {
    mount(fakeSocket().socket);
    openJoin();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the new table sheet", () => {
  it("seats the computers asked for once the table opens, each named and at its level", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    const sheet = newStep("rules");
    fireEvent.click(within(sheet).getByRole("button", { name: "+ Add computer" }));
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Shuffles" } });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Hard" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    // A second, left as it came: Standard, and any name.
    fireEvent.click(within(sheet).getByRole("button", { name: "+ Add computer" }));
    expect(within(sheet).getByRole("button", { name: "Edit Shuffles, Hard" })).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: "Edit Computer 2, Standard" }),
    ).toBeInTheDocument();
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.map((s) => s.event)).toEqual(["createRoom", "addBot", "addBot"]);
    expect(sent[1]!.args[0]).toEqual({ level: "hard", name: "Shuffles" });
    expect(sent[2]!.args[0]).toEqual({ level: "standard" });
  });

  it("takes a computer away again", () => {
    mount(fakeSocket().socket);
    const sheet = newStep("rules");
    fireEvent.click(within(sheet).getByRole("button", { name: "+ Add computer" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Remove" }));
    expect(within(sheet).queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(within(sheet).getByText("None yet, friends fill the seats")).toBeInTheDocument();
  });

  it("sets the rounds with the stepper, giving each a minimum", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    const sheet = newStep("rules");
    fireEvent.click(within(sheet).getByRole("button", { name: "Fewer rounds" }));
    expect(within(sheet).getByRole("group", { name: "Rounds" })).toHaveTextContent("3");
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    const { rules } = (sent[0]!.args[0] as { options: { rules: Record<string, unknown> } }).options;
    expect(rules.rounds).toBe(3);
    expect(rules.layDownMinimums).toEqual([60, 90, 120]);
  });

  it("suggests computer names in turn, skipping ones taken", () => {
    expect(suggestBotName("", [])).toBe("Shuffles");
    expect(suggestBotName("Shuffles", ["Shuffles"])).toBe("Card Shark");
    expect(suggestBotName("", ["Shuffles", "Card Shark"])).toBe("Lady Luck");
    expect(suggestBotName("Sir Melds-a-Lot", [])).toBe("Shuffles");
  });
});

describe("practice", () => {
  const openPractice = (): HTMLElement => {
    fireEvent.click(screen.getByRole("button", { name: /practice vs computers/i }));
    return screen.getByRole("dialog", { name: "Practice" });
  };

  it("opens a family table, seats three Standard computers and deals, in one go", async () => {
    window.localStorage.setItem(NAME_KEY, "ana");
    const { socket, sent } = fakeSocket();
    const { landed } = mount(socket);
    const sheet = openPractice();
    // No mode to choose: practice is always the family game.
    expect(within(sheet).queryByRole("radio", { name: /competitive/i })).toBeNull();
    expect(within(sheet).getByRole("group", { name: "Computer players" })).toHaveTextContent("3");
    fireEvent.click(within(sheet).getByRole("button", { name: "Deal me in" }));
    await waitFor(() => expect(sent).toHaveLength(5));
    expect(sent.map((s) => s.event)).toEqual([
      "createRoom",
      "addBot",
      "addBot",
      "addBot",
      "startGame",
    ]);
    expect(sent[0]!.args[0]).toMatchObject({
      name: "ana",
      options: { preset: "east-coast", mode: "family", rules: {} },
    });
    expect(sent[1]!.args[0]).toEqual({ level: "standard" });
    await waitFor(() => expect(landed()).toBe("/room/ABC234"));
  });

  it("sets how many computers, and each one's name and level", async () => {
    window.localStorage.setItem(NAME_KEY, "ana");
    const { socket, sent } = fakeSocket();
    mount(socket);
    const sheet = openPractice();
    fireEvent.click(within(sheet).getByRole("button", { name: "Fewer computer players" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Fewer computer players" }));
    // One opponent at least.
    expect(within(sheet).getByRole("button", { name: "Fewer computer players" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "More computer players" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Edit Computer 2, Standard" }));
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "Card Shark" } });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Hard" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(
      within(sheet).getByRole("button", { name: "Edit Card Shark, Hard" }),
    ).toBeInTheDocument();
    pickIn(sheet, /West Coast/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Deal me in" }));
    await waitFor(() => expect(sent).toHaveLength(4));
    expect(sent[0]!.args[0]).toMatchObject({ options: { preset: "west-coast", mode: "family" } });
    expect(sent.slice(1, 3).map((s) => s.args[0])).toEqual([
      { level: "standard" },
      { level: "hard", name: "Card Shark" },
    ]);
    expect(sent[3]!.event).toBe("startGame");
  });

  it("stops at most seven computers, a full table", () => {
    mount(fakeSocket().socket);
    const sheet = openPractice();
    const more = within(sheet).getByRole("button", { name: "More computer players" });
    for (let i = 0; i < 10; i++) fireEvent.click(more);
    expect(within(sheet).getByRole("group", { name: "Computer players" })).toHaveTextContent("7");
    expect(more).toBeDisabled();
  });

  it("asks for your card first when this device has no name yet", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.click(within(openPractice()).getByRole("button", { name: "Deal me in" }));
    expect(sent).toHaveLength(0);
    const card = screen.getByRole("dialog", { name: "Your player card" });
    fireEvent.change(within(card).getByLabelText(/your name/i), { target: { value: "ana" } });
    fireEvent.click(within(card).getByRole("button", { name: "Deal me in" }));
    await waitFor(() => expect(sent).toHaveLength(5));
    expect(sent[0]!.args[0]).toMatchObject({ name: "ana" });
  });

  it("remembers its own setup, and leaves New table's rules alone", async () => {
    window.localStorage.setItem(NAME_KEY, "ana");
    const { socket, sent } = fakeSocket();
    mount(socket);
    let sheet = openPractice();
    fireEvent.click(within(sheet).getByRole("button", { name: "Fewer rounds" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Fewer computer players" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Deal me in" }));
    await waitFor(() => expect(sent).toHaveLength(4));
    expect(window.localStorage.getItem(RULES_KEY)).toBeNull();
    cleanup();

    mount(fakeSocket().socket);
    sheet = openPractice();
    expect(within(sheet).getByRole("group", { name: "Rounds" })).toHaveTextContent("3");
    expect(within(sheet).getByRole("group", { name: "Computer players" })).toHaveTextContent("2");
  });

  it("starts from New table's rules as the family game, until it has its own", async () => {
    window.localStorage.setItem(NAME_KEY, "ana");
    window.localStorage.setItem(
      RULES_KEY,
      JSON.stringify({ preset: "west-coast", mode: "competitive", rules: {} }),
    );
    const { socket, sent } = fakeSocket();
    mount(socket);
    const sheet = openPractice();
    expect(
      (within(sheet).getByRole("radio", { name: /West Coast/ }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Deal me in" }));
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent[0]!.args[0]).toMatchObject({ options: { preset: "west-coast", mode: "family" } });
  });

  it("deals at once but stays in the waiting room when the deal is refused", async () => {
    window.localStorage.setItem(NAME_KEY, "ana");
    const { socket } = fakeSocket([
      { ok: true, data: { roomId: "ZZZ999", seat: 0, token: "t" } },
      { ok: true, data: undefined },
      { ok: true, data: undefined },
      { ok: true, data: undefined },
      { ok: false, error: "the table needs at least 2 players" },
    ]);
    const { landed } = mount(socket);
    fireEvent.click(within(openPractice()).getByRole("button", { name: "Deal me in" }));
    await waitFor(() => expect(landed()).toBe("/room/ZZZ999"));
    expect(useSession.getState().notice).toBe("the table needs at least 2 players");
  });

  it("does not deal when a computer could not sit down, leaving the notice in the waiting room", async () => {
    window.localStorage.setItem(NAME_KEY, "ana");
    const { socket, sent } = fakeSocket([
      { ok: true, data: { roomId: "ZZZ999", seat: 0, token: "t" } },
      { ok: true, data: undefined },
      { ok: false, error: "the table is full" },
    ]);
    const { landed } = mount(socket);
    fireEvent.click(within(openPractice()).getByRole("button", { name: "Deal me in" }));
    await waitFor(() => expect(landed()).toBe("/room/ZZZ999"));
    expect(sent.map((s) => s.event)).toEqual(["createRoom", "addBot", "addBot"]);
    expect(useSession.getState().notice).toBe("the table is full");
  });

  it("opens when the app moves to its address from the home screen", () => {
    let go: (path: string) => void = () => {};
    function Mover(): null {
      const navigate = useNavigate();
      go = (path) => navigate(path);
      return null;
    }
    const socket = fakeSocket().socket;
    const post = fakeUsers();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Home socket={socket} post={post} />} />
          <Route path="/practice" element={<Home socket={socket} post={post} />} />
        </Routes>
        <Mover />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => go("/practice"));
    expect(screen.getByRole("dialog", { name: "Practice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from its own address, and closing it goes home", () => {
    const { landed } = mount(fakeSocket().socket, "/practice");
    expect(screen.getByRole("dialog", { name: "Practice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(landed()).toBe("/");
  });
});

/** Choose an option of a choice in the given sheet. */
function pickIn(sheet: HTMLElement, option: RegExp | string): void {
  fireEvent.click(within(sheet).getByRole("radio", { name: option }));
}

describe("your player card", () => {
  it("starts on the finished card when signed in, sitting down as that name", async () => {
    window.localStorage.setItem(NAME_KEY, "Jack");
    window.localStorage.setItem(ACCOUNT_KEY, "jack");
    const { socket, sent } = fakeSocket();
    mount(socket, "/room/abc234");
    const card = screen.getByRole("dialog", { name: "Your player card" });
    expect(within(card).getByText("@jack")).toBeInTheDocument();
    expect(within(card).queryByLabelText(/your name/i)).toBeNull();
    // Changing it turns it into the editor.
    fireEvent.click(within(card).getByRole("button", { name: "Change picture or name" }));
    expect(within(card).getByLabelText(/your name/i)).toHaveValue("Jack");
    fireEvent.click(within(card).getByRole("button", { name: "Take a seat" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.event).toBe("joinRoom");
  });

  it("offers Sit down as the name, while signed in and not editing", () => {
    window.localStorage.setItem(NAME_KEY, "Jack");
    window.localStorage.setItem(ACCOUNT_KEY, "jack");
    mount(fakeSocket().socket, "/room/abc234");
    expect(screen.getByRole("button", { name: "Sit down as Jack" })).toBeInTheDocument();
  });

  it("picks a color for the face, and shuffles it", () => {
    mount(fakeSocket().socket);
    const card = newStep("card");
    fireEvent.click(within(card).getByRole("radio", { name: "lime" }));
    expect(JSON.parse(window.localStorage.getItem(AVATAR_KEY)!).background).toBe("lime");
    fireEvent.click(within(card).getByRole("button", { name: "Shuffle" }));
    expect(window.localStorage.getItem(AVATAR_KEY)).not.toBeNull();
  });
});
