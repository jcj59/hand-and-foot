import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Ack } from "@hf/shared";
import { CREDENTIALS_KEY } from "../credentials";
import { createServerClock } from "../serverTime";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
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
function mount(socket: HfClientSocket, path = "/"): { readonly landed: () => string | null } {
  let landed: string | null = null;
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Home socket={socket} />} />
        <Route path="/room/:roomId" element={<Home socket={socket} />} />
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
      args: [{ name: "ana", options: { preset: "west-coast", mode: "competitive" } }],
    });
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
    expect(sent[0]).toEqual({ event: "joinRoom", args: [{ roomId: "ABC234", name: "ben" }] });
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
