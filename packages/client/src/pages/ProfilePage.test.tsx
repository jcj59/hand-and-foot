/**
 * The profile page: the player card, the awards, the account (signing in, a
 * username, moving a profile between devices) and Sounds.
 */
import { afterEach, describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Ack } from "@hf/shared";
import { MATCHES_PATH } from "@hf/shared";
import { ACCOUNT_KEY, IDENTITY_KEY, NAME_KEY, type Post } from "../identity";
import { AVATAR_KEY } from "../profile/avatarStore";
import { PHONE_QUERY } from "../usePhone";
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

/** Open one of the account's sheets, as a tap on its button does. */
function openSheet(name: "Add a device" | "Sign in" | "Change password"): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  window.localStorage.removeItem(AVATAR_KEY);
  window.localStorage.removeItem("hf.muted");
  window.localStorage.removeItem(NAME_KEY);
  window.localStorage.removeItem(IDENTITY_KEY);
  window.localStorage.removeItem(ACCOUNT_KEY);
});

describe("moving a profile between devices", () => {
  it("registers this device's profile when the panel opens, then shows its code", async () => {
    window.localStorage.setItem(NAME_KEY, "Ana");
    const users = fakeUsers();
    mount(users);
    openSheet("Add a device");
    await waitFor(() => expect(screen.getByLabelText("Your transfer code")).not.toHaveValue("…"));
    const mine = JSON.parse(window.localStorage.getItem(IDENTITY_KEY)!);
    expect(users.sent).toEqual([{ ...mine, name: "Ana" }]);
    expect(screen.getByLabelText("Your transfer code")).toHaveValue(
      `hf1.${mine.userId}.${mine.secret}`,
    );
  });

  it("shows no code, and says why, when the profile cannot be registered", async () => {
    mount(fakeUsers({ ok: false, error: "down" }));
    openSheet("Add a device");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/could not reach the server/i),
    );
    expect(screen.getByLabelText("Your transfer code")).toHaveValue("…");
  });

  it("takes on another device's profile from its code", async () => {
    const users = fakeUsers();
    mount(users);
    openSheet("Add a device");
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
    openSheet("Add a device");
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
    openSheet("Sign in");
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
    expect(screen.getByText("@Ana")).toBeInTheDocument();
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
    openSheet("Sign in");
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
    openSheet("Sign in");
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
    openSheet("Sign in");
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
    expect(screen.getByText("@Ana")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Not signed in")).toBeInTheDocument());
    expect(window.localStorage.getItem(ACCOUNT_KEY)).toBeNull();
    openSheet("Sign in");
    expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument();
  });

  describe("when signed in", () => {
    const laptop = { userId: "ana-user-id-0001", secret: "a".repeat(40) };

    function signedIn(post: Post): void {
      window.localStorage.setItem(ACCOUNT_KEY, "Ana");
      window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(laptop));
      mount(post);
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
      openSheet("Change password");
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
      fireEvent.click(screen.getByRole("button", { name: "Sign out of this browser" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Signed out\./));
      expect(post.sent.at(-1)).toEqual({ path: "/api/account/sign-out", body: { user: laptop } });
      expect(window.localStorage.getItem(IDENTITY_KEY)).toBeNull();
      expect(window.localStorage.getItem(ACCOUNT_KEY)).toBeNull();
      expect(screen.getByText("Not signed in")).toBeInTheDocument();
      openSheet("Sign in");
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
    openSheet("Add a device");
    fireEvent.change(screen.getByLabelText("Code from another device"), {
      target: { value: `hf1.${other.userId}.${other.secret}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    await waitFor(() => expect(screen.getAllByText("@Ana").length).toBeGreaterThan(0));
    // Signed in, the sheet now says how to add a device rather than giving a code.
    expect(screen.getByRole("dialog", { name: "Other devices" })).toHaveTextContent(
      "open Profile on it and sign in as @Ana",
    );
  });
});

describe("the card, awards and sounds", () => {
  const me = { userId: "ana-user-id-0001", secret: "a".repeat(40) };

  /** A server that knows this player's history: two awards won, the rest not yet. */
  function withHistory(): Post & { asked: number } {
    const post = (async (path: string): Promise<Ack<unknown>> => {
      if (path === MATCHES_PATH) {
        post.asked++;
        return { ok: true, data: { stats: { awards: { grabby: 2, clean: 1 } }, recent: [] } };
      }
      return { ok: true, data: {} };
    }) as unknown as Post & { asked: number };
    post.asked = 0;
    return post;
  }

  const tile = (id: string): HTMLElement =>
    document.querySelector<HTMLElement>(`[data-award="${id}"]`)!;

  it("shows every award, with how often it was won or Not yet", async () => {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(me));
    const post = withHistory();
    mount(post);
    const awards = screen.getByRole("region", { name: "Awards" });
    expect(within(awards).getAllByRole("listitem")).toHaveLength(6);
    // Before the history answers, nothing is claimed.
    expect(tile("grabby")).toHaveTextContent("Not yet");
    await waitFor(() => expect(tile("grabby")).toHaveTextContent("×2"));
    expect(tile("grabby")).toHaveTextContent("Grabby Pants champion");
    expect(tile("grabby")).toHaveTextContent("won 2 times");
    expect(tile("clean")).toHaveTextContent("×1");
    expect(tile("clean")).toHaveTextContent("won once");
    expect(tile("marva")).toHaveTextContent("Marva's favorite");
    expect(tile("marva")).toHaveTextContent("Not yet");
    expect(tile("red-threes")).toHaveTextContent("not won yet");
    expect(post.asked).toBe(1);
  });

  it("does not ask for a history, or make a profile, for a device that never played", async () => {
    const post = withHistory();
    mount(post);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(post.asked).toBe(0);
    expect(window.localStorage.getItem(IDENTITY_KEY)).toBeNull();
    expect(tile("grabby")).toHaveTextContent("Not yet");
  });

  it("keeps a new name and picture on this device as they change", () => {
    window.localStorage.setItem(NAME_KEY, "Ana");
    mount();
    fireEvent.change(screen.getByLabelText("Name at the table"), { target: { value: "Anabel" } });
    expect(window.localStorage.getItem(NAME_KEY)).toBe("Anabel");
    fireEvent.click(screen.getByRole("radio", { name: "lime" }));
    expect(JSON.parse(window.localStorage.getItem(AVATAR_KEY)!).background).toBe("lime");
    expect(screen.getByRole("radio", { name: "lime" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Choose each part" }));
    expect(screen.getByRole("group", { name: "Eyes" })).toBeInTheDocument();
  });

  it("turns the table's sounds off and on", () => {
    mount();
    const sounds = screen.getByRole("switch", { name: "Sounds" });
    expect(sounds).toBeChecked();
    fireEvent.click(sounds);
    expect(window.localStorage.getItem("hf.muted")).toBe("1");
    expect(sounds).not.toBeChecked();
    fireEvent.click(sounds);
    expect(window.localStorage.getItem("hf.muted")).toBe("0");
  });

  describe("on a phone", () => {
    beforeEach(() => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: (query: string) => ({
          matches: query === PHONE_QUERY,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      });
    });
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it("lists the account and Sounds as rows, each opening its sheet", async () => {
      window.localStorage.setItem(ACCOUNT_KEY, "Ana");
      window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(me));
      mount(fakeUsers({ ok: true, data: { username: "Ana" } }));
      fireEvent.click(screen.getByRole("button", { name: /Signed in as\s*@Ana/ }));
      const account = screen.getByRole("dialog", { name: "Your account" });
      fireEvent.click(within(account).getByRole("button", { name: "Change password" }));
      expect(screen.getByRole("form", { name: "Change password" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      fireEvent.click(screen.getByRole("button", { name: /Other devices\s*Add or sign out/ }));
      expect(screen.getByRole("dialog", { name: "Other devices" })).toHaveTextContent(
        "Changing your password signs out every other device",
      );
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      const sounds = screen.getByRole("switch", { name: "Sounds" });
      expect(sounds).toHaveTextContent("On");
      fireEvent.click(sounds);
      expect(sounds).toHaveAttribute("aria-checked", "false");
      expect(sounds).toHaveTextContent("Off");
    });

    it("offers signing in from the first row when signed out", () => {
      mount();
      fireEvent.click(screen.getByRole("button", { name: /Account\s*Sign in/ }));
      expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument();
    });
  });
});
