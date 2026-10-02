import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Ack } from "@hf/shared";
import { CREDENTIALS_KEY } from "../credentials";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { IDENTITY_KEY, NAME_KEY, type Post } from "../identity";
import { RULES_KEY } from "../rules/customRules";
import { AVATAR_KEY } from "../profile/avatarStore";
import { Home } from "./Home";

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
      </Routes>
      <Landing onRender={(p) => (landed = p)} />
    </MemoryRouter>,
  );
  return { landed: () => landed };
}

/** Reports the current location, so a navigation is observable. */
function Landing({ onRender }: { readonly onRender: (path: string) => void }): null {
  onRender(window.location.pathname);
  return null;
}

const nameBox = (): HTMLElement => screen.getByLabelText(/your name/i);
const codeBox = (): HTMLElement => screen.getByLabelText(/table code/i);
const joinButton = (): HTMLElement => screen.getByRole("button", { name: /join table/i });
const createButton = (): HTMLElement => screen.getByRole("button", { name: /open a new table/i });

beforeEach(() => {
  window.localStorage.removeItem(CREDENTIALS_KEY);
  window.localStorage.removeItem(NAME_KEY);
  window.localStorage.removeItem(IDENTITY_KEY);
  window.localStorage.removeItem(RULES_KEY);
  window.localStorage.removeItem(AVATAR_KEY);
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
    fireEvent.change(screen.getByLabelText(/variant/i), { target: { value: "west-coast" } });
    fireEvent.change(screen.getByLabelText(/mode/i), { target: { value: "competitive" } });
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

    fireEvent.click(screen.getByRole("button", { name: "Change picture" }));
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
    expect(codeBox()).toHaveValue("ABC234");
    expect(screen.getByText(/invited to a table/i)).not.toBeNull();
    // The name is the only thing missing, so the cursor goes there.
    expect(nameBox()).toHaveFocus();
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

/** Open the folded profile panel, as a tap on its summary does. */
function openPanel(): void {
  const details = screen.getByText(/use your profile on another device/i).closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
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

  it("registers this device's profile when the panel opens, then shows its code", async () => {
    window.localStorage.setItem(NAME_KEY, "Ana");
    const users = fakeUsers();
    mount(fakeSocket().socket, "/", users);
    openPanel();
    await waitFor(() => expect(screen.getByLabelText("Your transfer code")).not.toHaveValue("…"));
    const mine = JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!);
    expect(users.sent).toEqual([{ ...mine, name: "Ana" }]);
    expect(screen.getByLabelText("Your transfer code")).toHaveValue(
      `hf1.${mine.userId}.${mine.secret}`,
    );
  });

  it("shows no code, and says why, when the profile cannot be registered", async () => {
    mount(fakeSocket().socket, "/", fakeUsers({ ok: false, error: "down" }));
    openPanel();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/could not reach the server/i),
    );
    expect(screen.getByLabelText("Your transfer code")).toHaveValue("…");
  });

  it("takes on another device's profile from its code", async () => {
    const users = fakeUsers();
    mount(fakeSocket().socket, "/", users);
    openPanel();
    const other = { userId: "other-device-user-01", secret: "s".repeat(40) };
    fireEvent.change(screen.getByLabelText("Code from another device"), {
      target: { value: `hf1.${other.userId}.${other.secret}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("This device now uses that profile."),
    );
    expect(JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!)).toEqual(other);
    expect(users.sent.at(-1)).toEqual({ ...other, existing: true });
    expect(screen.getByLabelText("Your transfer code")).toHaveValue(
      `hf1.${other.userId}.${other.secret}`,
    );
  });

  it("refuses a code that is not one, keeping this device's profile", async () => {
    mount(fakeSocket().socket);
    openPanel();
    await waitFor(() => expect(window.localStorage.getItem(IDENTITY_KEY)).not.toBeNull());
    const before = window.localStorage.getItem(IDENTITY_KEY);
    fireEvent.change(screen.getByLabelText("Code from another device"), {
      target: { value: "not a code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/not a transfer code/),
    );
    expect(window.localStorage.getItem(IDENTITY_KEY)).toBe(before);
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
  const field = (label: string): HTMLInputElement => screen.getByLabelText(label);
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
  });

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
    fireEvent.change(screen.getByLabelText(/mode/i), { target: { value: "competitive" } });
    expect(field("Pausing allowed").checked).toBe(false);
    fireEvent.click(field("Pausing allowed"));
    expect(screen.getByRole("alert")).toHaveTextContent(/competitive table cannot be paused/);
    expect(createButton()).toBeDisabled();
  });

  it("keeps the changes when the variant changes, and can go back to the preset", () => {
    mount(fakeSocket().socket);
    fireEvent.change(field("Hand"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText(/variant/i), { target: { value: "west-coast" } });
    expect(field("Hand").value).toBe("11");
    expect(screen.getByLabelText<HTMLSelectElement>("Wild cards in a meld").value).toBe(
      "naturals-equal-wilds",
    );
    fireEvent.click(screen.getByRole("button", { name: /back to the preset/i }));
    expect(field("Hand").value).toBe("14");
    expect(screen.getByLabelText<HTMLSelectElement>(/variant/i).value).toBe("west-coast");
  });

  it("remembers the last rules a table was opened with, on this device", async () => {
    const { socket, sent } = fakeSocket();
    mount(socket);
    fireEvent.change(nameBox(), { target: { value: "ana" } });
    fireEvent.change(screen.getByLabelText(/variant/i), { target: { value: "west-coast" } });
    fireEvent.change(field("Foot"), { target: { value: "9" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    cleanup();

    mount(fakeSocket().socket);
    expect(screen.getByLabelText<HTMLSelectElement>(/variant/i).value).toBe("west-coast");
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
