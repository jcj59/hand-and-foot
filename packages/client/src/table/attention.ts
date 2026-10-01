/**
 * Getting a player's attention when the turn comes to them and they are looking
 * at something else. Family games sit in a background tab for minutes at a time,
 * and the turn chime alone is easy to miss — or muted, or held back by a browser
 * that has not been tapped yet.
 *
 * This module is the decision only, pure and tested without a browser: whether the
 * tab should be signalling, what its title and favicon should be at each beat of a
 * flash, and when a notification should go up or come down. `useTurnAttention`
 * does what it is told.
 *
 * "My turn" is the very flag the turn chime is played from (`Moment.myTurn` in
 * `sounds.ts`), passed in rather than worked out again, so the tab can never claim
 * a turn the table does not.
 */

/** How long each half of a flash lasts: the title and icon swap this often. */
export const FLASH_MS = 1_000;

/** The title shown in the flash's "on" beat. Short, because a tab shows little. */
export const TURN_TITLE = "Your turn!";

/**
 * The title's prefix for players who have asked for less motion: the same news,
 * standing still.
 */
export const STEADY_PREFIX = "• Your turn – ";

/** What the tab knows about the player at one moment. */
export interface Watch {
  /** The player's turn is open — the chime's `myTurn`. */
  readonly myTurn: boolean;
  /** The tab is hidden or another window has focus. */
  readonly away: boolean;
  /** The player has asked their system for reduced motion. */
  readonly reducedMotion: boolean;
}

/** `none`: the tab looks as usual. `steady`: marked, unmoving. `flash`: blinking. */
export type Signal = "none" | "steady" | "flash";

/**
 * Whether, and how, the tab should be calling the player. Only while it is their
 * turn and they are away: a player looking at the table can see whose turn it is,
 * and the moment they come back the tab goes quiet.
 */
export function signalFor(watch: Watch): Signal {
  if (!watch.myTurn || !watch.away) return "none";
  return watch.reducedMotion ? "steady" : "flash";
}

/** The tab at one beat: its title, and whether the favicon carries the alert mark. */
export interface Frame {
  readonly title: string;
  readonly alert: boolean;
}

/**
 * The tab's title and favicon for a signal at beat `beat` (counted from 0 when the
 * signal began). A flash starts on its "on" beat, so the first thing that changes
 * is the news itself, and alternates with the page's own title so the tab is still
 * recognisable between beats.
 */
export function frameFor(signal: Signal, base: string, beat: number): Frame {
  switch (signal) {
    case "none":
      return { title: base, alert: false };
    case "steady":
      return { title: STEADY_PREFIX + base, alert: true };
    case "flash":
      return beat % 2 === 0 ? { title: TURN_TITLE, alert: true } : { title: base, alert: false };
  }
}

/**
 * Whether the turn that has just come round should raise a notification: the
 * player turned them on, the turn has *just* become theirs (not merely still
 * theirs — one per turn, never one per update), and they are not looking. The
 * page coming in on the player's turn is not news either: there is no `before`.
 */
export function shouldNotify(before: Watch | null, now: Watch, enabled: boolean): boolean {
  return enabled && before !== null && !before.myTurn && now.myTurn && now.away;
}

/**
 * Whether a notification already up has said all it can: the turn has passed, or
 * the player is back at the table and can see it for themselves.
 */
export function notificationSpent(now: Watch): boolean {
  return !now.myTurn || !now.away;
}

/** What the browser will let the page do with notifications. */
export type Permission = NotificationPermission | "unsupported";

/**
 * The notification toggle's state. `unsupported`: no `Notification` here at all,
 * so no toggle. `blocked`: the player (or their browser) said no, which only the
 * browser's own settings can undo, so the toggle says so rather than asking again.
 * `on` needs both the player's choice and the browser's permission — a choice
 * remembered on a device whose permission was later withdrawn is `off`.
 */
export type NotifyState = "unsupported" | "blocked" | "off" | "on";

export function notifyState(permission: Permission, enabled: boolean): NotifyState {
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "blocked";
  return permission === "granted" && enabled ? "on" : "off";
}
