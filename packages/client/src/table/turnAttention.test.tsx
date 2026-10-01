import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FAVICON, TURN_FAVICON, readNotify, useTurnAttention } from "./turnAttention";

// jsdom has no Notification and no matchMedia, and its `document.hasFocus()` is
// always false; each is put in place per test and taken away after.

let focused = true;

function setFocus(on: boolean): void {
  focused = on;
  act(() => {
    window.dispatchEvent(new Event(on ? "focus" : "blur"));
  });
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function icon(): string | null {
  return document.head.querySelector('link[rel="icon"]')?.getAttribute("href") ?? null;
}

/** A reduced-motion setting that can be changed while the page is open. */
function reducedMotion(initially: boolean): { set: (on: boolean) => void } {
  let matches = initially;
  const listeners = new Set<() => void>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query === "(prefers-reduced-motion: reduce)" && matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }),
  });
  return {
    set: (on) => {
      matches = on;
      act(() => listeners.forEach((fn) => fn()));
    },
  };
}

interface Shown {
  title: string;
  options: NotificationOptions;
  closed: boolean;
  onclick: (() => void) | null;
}

/**
 * A Notification that records what was shown. `answer` is what a permission
 * request resolves with; `legacy` answers through the callback only, as older
 * Safari does.
 */
function fakeNotification(
  permission: NotificationPermission,
  { answer = "granted", legacy = false, throws = false } = {},
): { shown: Shown[]; asked: () => number } {
  const shown: Shown[] = [];
  let asked = 0;
  class FakeNotification {
    static permission = permission;
    static requestPermission(callback?: (p: NotificationPermission) => void) {
      asked += 1;
      FakeNotification.permission = answer as NotificationPermission;
      if (legacy) {
        callback?.(answer as NotificationPermission);
        return undefined;
      }
      return Promise.resolve(answer);
    }
    readonly record: Shown;
    constructor(title: string, options: NotificationOptions) {
      if (throws) throw new TypeError("Illegal constructor");
      this.record = { title, options, closed: false, onclick: null };
      shown.push(this.record);
    }
    set onclick(fn: () => void) {
      this.record.onclick = fn;
    }
    close() {
      this.record.closed = true;
    }
  }
  Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
  return { shown, asked: () => asked };
}

function mountHook(initial: { myTurn: boolean; muted?: boolean }) {
  return renderHook(
    ({ myTurn, muted }: { myTurn: boolean; muted: boolean }) =>
      useTurnAttention(myTurn, "Table ABC234", muted),
    { initialProps: { myTurn: initial.myTurn, muted: initial.muted ?? false } },
  );
}

beforeEach(() => {
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  document.title = "Hand and Foot";
  document.head.querySelector('link[rel="icon"]')?.remove();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
  delete (window as { matchMedia?: unknown }).matchMedia;
  delete (window as { Notification?: unknown }).Notification;
});

describe("the tab title and favicon", () => {
  it("stay as they are while the player is looking at their turn", () => {
    mountHook({ myTurn: true });
    expect(document.title).toBe("Hand and Foot");
    expect(icon()).toBeNull();
  });

  it("flash while it is the player's turn and another window has focus", () => {
    vi.useFakeTimers();
    mountHook({ myTurn: true });
    setFocus(false);
    expect(document.title).toBe("Your turn!");
    expect(icon()).toBe(TURN_FAVICON);
    act(() => vi.advanceTimersByTime(1_000));
    expect(document.title).toBe("Hand and Foot");
    expect(icon()).toBe(FAVICON);
    act(() => vi.advanceTimersByTime(1_000));
    expect(document.title).toBe("Your turn!");
  });

  it("flash when the tab is hidden, and stop when it is shown again", () => {
    vi.useFakeTimers();
    mountHook({ myTurn: true });
    setHidden(true);
    expect(document.title).toBe("Your turn!");
    setHidden(false);
    expect(document.title).toBe("Hand and Foot");
    expect(icon()).toBe(FAVICON);
    // Nothing is left ticking: no beat, odd or even, changes the title again.
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1_000));
    expect(document.title).toBe("Hand and Foot");
    act(() => vi.advanceTimersByTime(1_000));
    expect(document.title).toBe("Hand and Foot");
  });

  it("are put back when the player returns mid-flash, on the off beat or the on", () => {
    vi.useFakeTimers();
    mountHook({ myTurn: true });
    setFocus(false);
    setFocus(true);
    expect(document.title).toBe("Hand and Foot");
    expect(icon()).toBe(FAVICON);
  });

  it("are put back when the turn passes", () => {
    vi.useFakeTimers();
    const { rerender } = mountHook({ myTurn: true });
    setFocus(false);
    rerender({ myTurn: false, muted: false });
    expect(document.title).toBe("Hand and Foot");
    expect(icon()).toBe(FAVICON);
  });

  it("start when the turn comes to a player who is away", () => {
    vi.useFakeTimers();
    const { rerender } = mountHook({ myTurn: false });
    setFocus(false);
    expect(document.title).toBe("Hand and Foot");
    rerender({ myTurn: true, muted: false });
    expect(document.title).toBe("Your turn!");
  });

  it("are put back when the table goes away", () => {
    vi.useFakeTimers();
    const { unmount } = mountHook({ myTurn: true });
    setFocus(false);
    unmount();
    expect(document.title).toBe("Hand and Foot");
    expect(icon()).toBe(FAVICON);
  });

  it("restore the page's own favicon, whatever it was", () => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "/elsewhere.svg";
    document.head.appendChild(link);
    vi.useFakeTimers();
    mountHook({ myTurn: true });
    setFocus(false);
    expect(link.getAttribute("href")).toBe(TURN_FAVICON);
    // The off beat shows the page's icon, not this app's default.
    act(() => vi.advanceTimersByTime(1_000));
    expect(link.getAttribute("href")).toBe("/elsewhere.svg");
    setFocus(true);
    expect(link.getAttribute("href")).toBe("/elsewhere.svg");
  });

  it("keep a favicon link that had no address without one afterwards", () => {
    const link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
    vi.useFakeTimers();
    mountHook({ myTurn: true });
    setFocus(false);
    // Its off beat shows the page's icon, since the page named none.
    act(() => vi.advanceTimersByTime(1_000));
    expect(link.getAttribute("href")).toBe(FAVICON);
    setFocus(true);
    expect(link.hasAttribute("href")).toBe(false);
  });

  it("hold still for reduced motion: a marked title, no flashing", () => {
    vi.useFakeTimers();
    reducedMotion(true);
    mountHook({ myTurn: true });
    setFocus(false);
    expect(document.title).toBe("• Your turn – Hand and Foot");
    expect(icon()).toBe(TURN_FAVICON);
    // Nothing is even scheduled.
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5_000));
    expect(document.title).toBe("• Your turn – Hand and Foot");
    setFocus(true);
    expect(document.title).toBe("Hand and Foot");
  });

  it("follow a reduced-motion setting changed while the page is open", () => {
    vi.useFakeTimers();
    const motion = reducedMotion(false);
    const { unmount } = mountHook({ myTurn: true });
    setFocus(false);
    expect(document.title).toBe("Your turn!");
    motion.set(true);
    expect(document.title).toBe("• Your turn – Hand and Foot");
    unmount();
    // The listener went with the table.
    motion.set(false);
    expect(document.title).toBe("Hand and Foot");
  });
});

describe("turn notifications", () => {
  afterEach(() => window.localStorage.removeItem("hf.notifyTurn"));

  it("are not offered where the browser has none", () => {
    const { result } = mountHook({ myTurn: false });
    expect(result.current.notify).toBe("unsupported");
    // The toggle does nothing rather than throw.
    act(() => result.current.toggleNotify());
    expect(result.current.notify).toBe("unsupported");
  });

  it("are off until turned on, and asking happens only on that tap", async () => {
    const fake = fakeNotification("default");
    const { result } = mountHook({ myTurn: false });
    expect(result.current.notify).toBe("off");
    expect(fake.asked()).toBe(0);
    await act(async () => result.current.toggleNotify());
    expect(fake.asked()).toBe(1);
    expect(result.current.notify).toBe("on");
    expect(readNotify()).toBe(true);
  });

  it("take the old callback form of the permission request too", async () => {
    fakeNotification("default", { legacy: true });
    const { result } = mountHook({ myTurn: false });
    await act(async () => result.current.toggleNotify());
    expect(result.current.notify).toBe("on");
  });

  it("stay off, and say blocked, when the player refuses", async () => {
    fakeNotification("default", { answer: "denied" });
    const { result } = mountHook({ myTurn: false });
    await act(async () => result.current.toggleNotify());
    expect(result.current.notify).toBe("blocked");
    expect(readNotify()).toBe(false);
  });

  it("stay off when the request is dismissed or fails", async () => {
    fakeNotification("default", { answer: "default" });
    const { result } = mountHook({ myTurn: false });
    await act(async () => result.current.toggleNotify());
    expect(result.current.notify).toBe("off");
    expect(readNotify()).toBe(false);
    Object.defineProperty(window.Notification, "requestPermission", {
      configurable: true,
      value: () => Promise.reject(new Error("no")),
    });
    await act(async () => result.current.toggleNotify());
    expect(result.current.notify).toBe("off");
  });

  it("do not ask again once permission is granted, and turn off and on", async () => {
    const fake = fakeNotification("granted");
    const { result } = mountHook({ myTurn: false });
    await act(async () => result.current.toggleNotify());
    expect(result.current.notify).toBe("on");
    act(() => result.current.toggleNotify());
    expect(result.current.notify).toBe("off");
    expect(readNotify()).toBe(false);
    expect(fake.asked()).toBe(0);
  });

  it("do nothing on a tap once blocked: only the browser's settings can undo that", () => {
    const fake = fakeNotification("denied");
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { result } = mountHook({ myTurn: false });
    act(() => result.current.toggleNotify());
    expect(fake.asked()).toBe(0);
    expect(result.current.notify).toBe("blocked");
    // Nor does it forget the player's choice: allowed again in the settings, it is on.
    (window.Notification as unknown as { permission: string }).permission = "granted";
    setFocus(false);
    expect(result.current.notify).toBe("on");
  });

  it("are remembered on the device", () => {
    fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    expect(mountHook({ myTurn: false }).result.current.notify).toBe("on");
  });

  it("notice permission withdrawn in the browser's settings when the player comes back", () => {
    fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { result } = mountHook({ myTurn: false });
    (window.Notification as unknown as { permission: string }).permission = "denied";
    setFocus(false);
    setFocus(true);
    expect(result.current.notify).toBe("blocked");
  });

  it("go up once when the turn comes to a player who is away, and close when they return", () => {
    const fake = fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { rerender } = mountHook({ myTurn: false });
    setFocus(false);
    rerender({ myTurn: true, muted: false });
    expect(fake.shown).toHaveLength(1);
    expect(fake.shown[0]).toMatchObject({
      title: "Your turn!",
      options: { body: "Table ABC234", tag: "hf-turn", silent: false },
      closed: false,
    });
    // Still their turn: no second one.
    rerender({ myTurn: true, muted: false });
    expect(fake.shown).toHaveLength(1);
    setFocus(true);
    expect(fake.shown[0]!.closed).toBe(true);
  });

  it("close when the turn passes", () => {
    const fake = fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { rerender } = mountHook({ myTurn: false });
    setFocus(false);
    rerender({ myTurn: true, muted: false });
    rerender({ myTurn: false, muted: false });
    expect(fake.shown[0]!.closed).toBe(true);
  });

  it("close with the table, so none points at a table that is gone", () => {
    const fake = fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { rerender, unmount } = mountHook({ myTurn: false });
    setFocus(false);
    rerender({ myTurn: true, muted: false });
    unmount();
    expect(fake.shown[0]!.closed).toBe(true);
  });

  it("bring the table forward when clicked", () => {
    const fake = fakeNotification("granted");
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { rerender } = mountHook({ myTurn: false });
    setFocus(false);
    rerender({ myTurn: true, muted: false });
    fake.shown[0]!.onclick!();
    expect(focus).toHaveBeenCalled();
    expect(fake.shown[0]!.closed).toBe(true);
  });

  it("are silent when the table is muted", () => {
    const fake = fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { rerender } = mountHook({ myTurn: false, muted: true });
    setFocus(false);
    rerender({ myTurn: true, muted: true });
    expect(fake.shown[0]!.options.silent).toBe(true);
  });

  it("are not raised for a player who has them off", () => {
    const fake = fakeNotification("granted");
    const { rerender } = mountHook({ myTurn: false });
    setFocus(false);
    rerender({ myTurn: true, muted: false });
    expect(fake.shown).toHaveLength(0);
  });

  it("are not raised for a player who is looking at the table", () => {
    const fake = fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { rerender } = mountHook({ myTurn: false });
    rerender({ myTurn: true, muted: false });
    expect(fake.shown).toHaveLength(0);
  });

  it("are not raised for the turn the page opened on", () => {
    const fake = fakeNotification("granted");
    window.localStorage.setItem("hf.notifyTurn", "1");
    focused = false;
    mountHook({ myTurn: true });
    expect(fake.shown).toHaveLength(0);
  });

  it("fail quietly where a page may not make one (Chrome on Android)", () => {
    const fake = fakeNotification("granted", { throws: true });
    window.localStorage.setItem("hf.notifyTurn", "1");
    const { rerender } = mountHook({ myTurn: false });
    setFocus(false);
    expect(() => rerender({ myTurn: true, muted: false })).not.toThrow();
    expect(fake.shown).toHaveLength(0);
    // The tab still flashes.
    expect(document.title).toBe("Your turn!");
  });

  it("keep the choice for the page when storage is blocked", async () => {
    fakeNotification("granted");
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = mountHook({ myTurn: false });
    expect(result.current.notify).toBe("off");
    await act(async () => result.current.toggleNotify());
    expect(result.current.notify).toBe("on");
    get.mockRestore();
    set.mockRestore();
  });
});
