/**
 * What the page has been doing lately, kept so a bug report can carry it: the
 * frames sent and received over the table socket, everything written to the
 * console, and the notices shown. Each is a ring of the newest few, in memory
 * only; nothing is stored or sent until the player sends a report themselves.
 *
 * A frame is cleared of secrets as it is kept (`scrubSecrets`): the socket
 * carries seat tokens (`resumeSeat`) and identity secrets (sitting down), and a
 * ring holding them would only be one bug away from sending them.
 */
import { scrubSecrets, secretsIn } from "@hf/shared";
import { clip, keepLast } from "./errors";

/** How many socket frames are kept, sent and received together. */
export const FRAMES_KEPT = 200;
/** How many console lines are kept, of every level. */
export const CONSOLE_KEPT = 200;
/** How many notices (the server's refusals, put on screen) are kept. */
export const NOTICES_KEPT = 50;
/** The longest console line kept, in characters. */
export const CONSOLE_LINE_MAX = 2000;

export interface FrameRecord {
  readonly at: number;
  readonly direction: "sent" | "received";
  readonly frame: unknown;
}

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";
export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

export interface ConsoleRecord {
  readonly at: number;
  readonly level: ConsoleLevel;
  readonly message: string;
}

export interface NoticeRecord {
  readonly at: number;
  readonly text: string;
}

let frames: FrameRecord[] = [];
let lines: ConsoleRecord[] = [];
let notices: NoticeRecord[] = [];
/**
 * The secrets the kept frames carried, so a report can search the console and
 * everything else for them too: a token sent over the socket may have been
 * logged, and by the time of the report this browser may hold it nowhere else.
 */
let secrets = new Set<string>();

/** Keep one socket frame, cleared of secrets. */
export function noteFrame(direction: "sent" | "received", frame: unknown, at = Date.now()): void {
  for (const secret of secretsIn(frame)) secrets.add(secret);
  frames = keepLast(frames, { at, direction, frame: scrubSecrets(frame) }, FRAMES_KEPT);
}

/** One console argument as text: an error with its stack, anything else as JSON if it can be. */
export function describeArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unreadable]";
    }
  }
}

/** Keep one console line. */
export function noteConsole(level: ConsoleLevel, args: readonly unknown[], at = Date.now()): void {
  const message = clip(args.map(describeArgument).join(" "), CONSOLE_LINE_MAX);
  lines = keepLast(lines, { at, level, message }, CONSOLE_KEPT);
}

/** Keep one notice. */
export function noteNotice(text: string, at = Date.now()): void {
  notices = keepLast(notices, { at, text }, NOTICES_KEPT);
}

/** The kept frames, console lines and notices, each oldest first. */
export function recentRecords(): {
  readonly frames: readonly FrameRecord[];
  readonly console: readonly ConsoleRecord[];
  readonly notices: readonly NoticeRecord[];
  /** Every secret a frame carried, for the report to search for. */
  readonly secrets: readonly string[];
} {
  return { frames, console: lines, notices, secrets: [...secrets] };
}

/** Forget everything kept (between tests). */
export function forgetRecords(): void {
  frames = [];
  lines = [];
  notices = [];
  secrets = new Set();
}

type ConsoleLike = Record<ConsoleLevel, (...args: unknown[]) => void>;

/**
 * Keep every console line written on `target` (the page's console), at every
 * level, and still write it as before. Returns a teardown that puts the console
 * back. A line that cannot be kept is still written.
 */
export function installConsoleLog(target: ConsoleLike, now: () => number = Date.now): () => void {
  const originals = CONSOLE_LEVELS.map((level) => [level, target[level]] as const);
  for (const [level, original] of originals) {
    target[level] = (...args: unknown[]) => {
      try {
        noteConsole(level, args, now());
      } catch {
        // Only a recorder: the line is written whatever happens here.
      }
      original.apply(target, args);
    };
  }
  return () => {
    for (const [level, original] of originals) target[level] = original;
  };
}

/**
 * Keep each new notice a store puts up, by subscribing to it. Returns the
 * unsubscribe.
 */
export function installNoticeLog(store: {
  subscribe(
    listener: (state: { notice: string | null }, previous: { notice: string | null }) => void,
  ): () => void;
}): () => void {
  return store.subscribe((state, previous) => {
    if (state.notice !== null && state.notice !== previous.notice) noteNotice(state.notice);
  });
}
