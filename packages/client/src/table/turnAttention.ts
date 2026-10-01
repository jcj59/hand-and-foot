/**
 * The tab calls the player when their turn comes and they are elsewhere: the
 * title and favicon flash (or, for reduced motion, are marked and hold still), and
 * if the player has turned it on, a browser notification goes up. Both stop the
 * moment the turn passes or the player comes back. `attention.ts` decides all of
 * that; this is the browser glue.
 *
 * Notifications are off until the player turns them on, and permission is asked
 * for only then, from that tap — a prompt on page load is one most people refuse,
 * and a refusal cannot be asked again. Where `Notification` does not exist, or the
 * browser will not construct one from a page (Chrome on Android wants a service
 * worker for that), the toggle is hidden or the notification simply does not
 * appear; nothing else depends on it.
 */
import { useEffect, useRef, useState } from "react";
import {
  FLASH_MS,
  TURN_TITLE,
  frameFor,
  notificationSpent,
  notifyState,
  shouldNotify,
  signalFor,
  type NotifyState,
  type Permission,
  type Watch,
} from "./attention";

/** The page's own favicon, and the one with the alert mark. Both in `public/`. */
export const FAVICON = "/favicon.svg";
export const TURN_FAVICON = "/favicon-turn.svg";

const NOTIFY_KEY = "hf.notifyTurn";

export function readNotify(): boolean {
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNotify(on: boolean): void {
  try {
    window.localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

function readPermission(): Permission {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/**
 * Ask for permission. Older Safari takes a callback and returns nothing rather than
 * a promise, so both are listened to; whichever answers first decides.
 */
function requestPermission(): Promise<NotificationPermission> {
  return new Promise((resolve) => {
    const asked = Notification.requestPermission(resolve) as
      Promise<NotificationPermission> | undefined;
    asked?.then(resolve, () => resolve("default"));
  });
}

function isAway(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** The page's favicon link, made if the page has none (as under test). */
function iconLink(): HTMLLinkElement {
  const found = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (found) return found;
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = FAVICON;
  document.head.appendChild(link);
  return link;
}

/**
 * Call the player when their turn comes and they are not looking. `myTurn` is the
 * turn chime's own flag, `label` says which table (a notification is read away from
 * it), and `muted` keeps a notification silent too. Returns the notification
 * toggle's state and the way to flip it, which must be called from a tap.
 */
export function useTurnAttention(
  myTurn: boolean,
  label: string,
  muted: boolean,
): { notify: NotifyState; toggleNotify: () => void } {
  const [away, setAway] = useState(isAway);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [permission, setPermission] = useState(readPermission);
  const [enabled, setEnabled] = useState(readNotify);

  useEffect(() => {
    // Permission can change in the browser's settings while the page is open; it is
    // read again whenever the player comes back.
    const onChange = (): void => {
      setAway(isAway());
      setPermission(readPermission());
    };
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("focus", onChange);
    window.addEventListener("blur", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("focus", onChange);
      window.removeEventListener("blur", onChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = (): void => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const signal = signalFor({ myTurn, away, reducedMotion });

  // The title and favicon, for as long as the signal holds. Whatever they were is
  // put back when it ends — the turn passed, the player came back, or the table
  // closed — so the next signal starts from the page's own.
  useEffect(() => {
    if (signal === "none") return;
    const base = document.title;
    const link = iconLink();
    const icon = link.getAttribute("href");
    let beat = 0;
    const show = (): void => {
      const frame = frameFor(signal, base, beat);
      document.title = frame.title;
      link.setAttribute("href", frame.alert ? TURN_FAVICON : (icon ?? FAVICON));
    };
    show();
    const timer =
      signal === "flash"
        ? window.setInterval(() => {
            beat += 1;
            show();
          }, FLASH_MS)
        : undefined;
    return () => {
      window.clearInterval(timer);
      document.title = base;
      if (icon === null) link.removeAttribute("href");
      else link.setAttribute("href", icon);
    };
  }, [signal]);

  const notify = notifyState(permission, enabled);
  const before = useRef<Watch | null>(null);
  const shown = useRef<Notification | null>(null);
  const labelRef = useRef(label);
  labelRef.current = label;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    const now: Watch = { myTurn, away, reducedMotion };
    const previous = before.current;
    before.current = now;
    if (shown.current && notificationSpent(now)) {
      shown.current.close();
      shown.current = null;
    }
    if (!shouldNotify(previous, now, notify === "on")) return;
    try {
      const notification = new Notification(TURN_TITLE, {
        body: labelRef.current,
        tag: "hf-turn",
        icon: "/icons/icon-192.png",
        silent: mutedRef.current,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      shown.current = notification;
    } catch {
      // Chrome on Android refuses a notification made by a page rather than a
      // service worker; the flashing tab has to do.
    }
  }, [myTurn, away, reducedMotion, notify]);

  // A notification outlives the page unless closed, and would then point at a
  // table that is gone.
  useEffect(() => () => shown.current?.close(), []);

  return {
    notify,
    toggleNotify: () => {
      if (notify === "on") {
        setEnabled(false);
        writeNotify(false);
      } else if (notify === "off") {
        const turnOn = (granted: NotificationPermission): void => {
          setPermission(granted);
          if (granted !== "granted") return;
          setEnabled(true);
          writeNotify(true);
        };
        if (permission === "granted") turnOn("granted");
        else void requestPermission().then(turnOn);
      }
    },
  };
}
