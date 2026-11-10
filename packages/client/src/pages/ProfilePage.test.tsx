/**
 * The profile page's account panel: signing in, a username, moving a profile
 * between devices. (These moved here from the home screen with the panel.)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Ack } from "@hf/shared";
import { ACCOUNT_KEY, IDENTITY_KEY, NAME_KEY, type Post } from "../identity";
import { ProfilePage } from "./ProfilePage";

function fakeUsers(answer: Ack<unknown> = { ok: true, data: {} }): Post & { sent: unknown[] } {
  const sent: unknown[] = [];
  const post = (async (_path: string, body: unknown) => {
    sent.push(body);
    return answer;
  }) as Post & { sent: unknown[] };
  post.sent = sent;
  return post;
}

function mount(post: Post = fakeUsers()): void {
  render(
    <MemoryRouter>
      <ProfilePage post={post} />
    </MemoryRouter>,
  );
}

/** Open the folded profile panel, as a tap on its summary does. */
function openPanel(): void {
  const details = screen.getByText(/use your profile on another device/i).closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

beforeEach(() => {
  window.localStorage.removeItem(NAME_KEY);
  window.localStorage.removeItem(IDENTITY_KEY);
  window.localStorage.removeItem(ACCOUNT_KEY);
});

describe("moving a profile between devices", () => {
  it("registers this device's profile when the panel opens, then shows its code", async () => {
    window.localStorage.setItem(NAME_KEY, "Ana");
    const users = fakeUsers();
    mount(users);
    openPanel();
    await waitFor(() => expect(screen.getByLabelText("Your transfer code")).not.toHaveValue("…"));
    const mine = JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!);
    expect(users.sent).toEqual([{ ...mine, name: "Ana" }]);
    expect(screen.getByLabelText("Your transfer code")).toHaveValue(
      `hf1.${mine.userId}.${mine.secret}`,
    );
  });

  it("shows no code, and says why, when the profile cannot be registered", async () => {
    mount(fakeUsers({ ok: false, error: "down" }));
    openPanel();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/could not reach the server/i),
    );
    expect(screen.getByLabelText("Your transfer code")).toHaveValue("…");
  });

  it("takes on another device's profile from its code", async () => {
    const users = fakeUsers();
    mount(users);
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
    mount();
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

describe("signing in", () => {
  /**
   * A server answering each path from its own list, remembering what it was sent.
   * The match history on the same screen asks too, and is told there is none.
   */
  function server(answers: Record<string, Ack<unknown>[]>): Post & {
    sent: { path: string; body: unknown }[];
  } {
    const sent: { path: string; body: unknown }[] = [];
    const post = (async (path: string, body: unknown) => {
      if (path === "/api/users/matches") return { ok: false, error: "none" };
      sent.push({ path, body });
      return answers[path]?.shift() ?? { ok: true, data: {} };
    }) as Post & { sent: { path: string; body: unknown }[] };
    post.sent = sent;
    return post;
  }

  const form = (name: string): HTMLElement => screen.getByRole("form", { name });
  const type = (scope: HTMLElement, label: string, value: string): void => {
    fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
  };

  it("signs this device in, and then says whose profile it plays as", async () => {
    const phone = { userId: "ana-user-id-0001", secret: "p".repeat(43) };
    const post = server({
      "/api/account/sign-in": [{ ok: true, data: { ...phone, username: "Ana", name: "Ana" } }],
    });
    mount(post);
    openPanel();
    const signIn = form("Sign in");
    type(signIn, "Username", " ana ");
    type(signIn, "Password", "correct horse");
    fireEvent.click(within(signIn).getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Signed in as Ana. This device now plays as that profile.",
      ),
    );
    expect(post.sent.at(-1)).toEqual({
      path: "/api/account/sign-in",
      body: { username: "ana", password: "correct horse", name: "" },
    });
    expect(JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!)).toEqual(phone);
    expect(screen.getByText("Signed in as Ana")).toBeInTheDocument();
    // Signed in, the profile's name is the one this device sits down as.
    expect(window.localStorage.getItem(NAME_KEY)).toBe("Ana");
    expect(screen.queryByRole("form", { name: "Sign in" })).toBeNull();
  });

  it("says why signing in was refused, and stays signed out", async () => {
    mount(
      server({
        "/api/account/sign-in": [{ ok: false, error: "that username and password do not match" }],
      }),
    );
    openPanel();
    const signIn = form("Sign in");
    expect(within(signIn).getByRole("button", { name: "Sign in" })).toBeDisabled();
    type(signIn, "Username", "ana");
    type(signIn, "Password", "wrong horse");
    fireEvent.click(within(signIn).getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "That username and password do not match",
      ),
    );
    expect(within(signIn).getByLabelText("Password")).toHaveValue("wrong horse");
    expect(window.localStorage.getItem(ACCOUNT_KEY)).toBeNull();
  });

  it("gives this profile a username, asking for the password twice", async () => {
    const post = server({ "/api/account/claim": [{ ok: true, data: { username: "Ana" } }] });
    mount(post);
    openPanel();
    const claim = form("Choose a username");
    expect(claim).toHaveTextContent(/no way to reset a forgotten password/);
    const save = within(claim).getByRole("button", { name: "Save username" });
    type(claim, "Username", "Ana");
    type(claim, "Password", "short");
    expect(claim).toHaveTextContent("A password needs at least 8 characters.");
    type(claim, "Password", "correct horse");
    type(claim, "Password again", "correct hose");
    expect(claim).toHaveTextContent("The two passwords are not the same.");
    expect(save).toBeDisabled();
    type(claim, "Password again", "correct horse");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "This profile is now Ana. Sign in with it on your other devices.",
      ),
    );
    const mine = JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!);
    expect(post.sent.at(-1)).toEqual({
      path: "/api/account/claim",
      body: { user: mine, username: "Ana", password: "correct horse" },
    });
    expect(window.localStorage.getItem(ACCOUNT_KEY)).toBe("Ana");
  });

  it("says why a username was refused, keeping what was typed", async () => {
    mount(server({ "/api/account/claim": [{ ok: false, error: "that username is taken" }] }));
    openPanel();
    const claim = form("Choose a username");
    type(claim, "Username", "Ana");
    type(claim, "Password", "correct horse");
    type(claim, "Password again", "correct horse");
    fireEvent.click(within(claim).getByRole("button", { name: "Save username" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("That username is taken"),
    );
    expect(within(claim).getByLabelText("Username")).toHaveValue("Ana");
  });

  it("learns on opening that this device was signed out elsewhere", async () => {
    window.localStorage.setItem(ACCOUNT_KEY, "Ana");
    window.localStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ userId: "ana-user-id-0001", secret: "a".repeat(40) }),
    );
    mount(
      server({
        "/api/users": [{ ok: false, error: "that identity belongs to another browser" }],
      }),
    );
    const details = screen.getByText("Signed in as Ana").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument());
    expect(window.localStorage.getItem(ACCOUNT_KEY)).toBeNull();
  });

  describe("when signed in", () => {
    const laptop = { userId: "ana-user-id-0001", secret: "a".repeat(40) };

    function signedIn(post: Post): void {
      window.localStorage.setItem(ACCOUNT_KEY, "Ana");
      window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(laptop));
      mount(post);
      const details = screen.getByText("Signed in as Ana").closest("details")!;
      details.open = true;
      fireEvent(details, new Event("toggle"));
    }

    it("changes the password, saying the other devices are signed out", async () => {
      const post = server({
        "/api/users": [{ ok: true, data: { username: "Ana" } }],
        "/api/account/password": [
          { ok: false, error: "that username and password do not match" },
          { ok: true, data: null },
        ],
      });
      signedIn(post);
      const change = form("Change password");
      type(change, "Current password", "wrong horse");
      type(change, "New password", "battery staple");
      type(change, "New password again", "battery staple");
      fireEvent.click(within(change).getByRole("button", { name: "Change password" }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "That username and password do not match",
        ),
      );
      type(change, "Current password", "correct horse");
      fireEvent.click(within(change).getByRole("button", { name: "Change password" }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "Password changed. Every other device has been signed out.",
        ),
      );
      expect(post.sent.at(-1)).toEqual({
        path: "/api/account/password",
        body: { user: laptop, password: "correct horse", newPassword: "battery staple" },
      });
      expect(within(change).getByLabelText("New password")).toHaveValue("");
    });

    it("signs this device out, which then starts afresh", async () => {
      const post = server({ "/api/users": [{ ok: true, data: { username: "Ana" } }] });
      signedIn(post);
      await waitFor(() => expect(post.sent).toHaveLength(1));
      fireEvent.click(screen.getByRole("button", { name: "Sign out on this device" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Signed out\./));
      expect(post.sent.at(-1)).toEqual({ path: "/api/account/sign-out", body: { user: laptop } });
      expect(window.localStorage.getItem(IDENTITY_KEY)).toBeNull();
      expect(window.localStorage.getItem(ACCOUNT_KEY)).toBeNull();
      expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument();
    });
  });

  it("comes signed in with a code from a profile that has a username", async () => {
    const other = { userId: "other-device-user-01", secret: "s".repeat(40) };
    mount(
      server({
        "/api/users": [
          { ok: true, data: {} },
          { ok: true, data: { username: "Ana" } },
        ],
      }),
    );
    openPanel();
    fireEvent.change(screen.getByLabelText("Code from another device"), {
      target: { value: `hf1.${other.userId}.${other.secret}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(screen.getByText("Signed in as Ana")).toBeInTheDocument());
  });
});
