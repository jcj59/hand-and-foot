// Bug reports from players: what the client sends and what the game keeps.
//
// A report is what the player wrote plus everything the game knows that could
// help a developer recreate the bug: the client attaches the whole page (the
// table as this seat sees it, its staging, the socket's recent frames, console
// output, storage, the device), and the server attaches the table's own record
// (config, seed, every move, the full game state, the chat), which is what lets
// the game be replayed exactly. Reports are read back only with a secret token,
// so other players' cards may be in one; secrets never are: `scrubSecrets`
// removes them on both ends.
//
// The server checks the shape and the size, never the contents.
import type { Avatar } from "./avatar";
import type { BotLevel } from "./bots";
import type { GameState, RulesConfig } from "./index";
import type { ChatMessage, LoggedAction } from "./protocol";

/** Send a report: POST `{ text, room?, context? }`. Reading them back is GET, with a token. */
export const REPORTS_PATH = "/api/reports";

/** The most a player may write, in characters, after trimming. */
export const REPORT_TEXT_MAX = 2000;
/**
 * The most a client may send, in bytes of JSON: its text and everything it
 * attached. Half of `MAX_REPORT_BYTES`, so the table's record (a full match's
 * moves are about 200 KB at six seats) still fits beside it.
 */
export const MAX_REPORT_BODY_BYTES = 256 * 1024;
/**
 * The most a kept report may be, in bytes of JSON, once the server has attached
 * the table's record. Well under a Durable Object's 2 MB value limit, even
 * stored as two bytes a character.
 */
export const MAX_REPORT_BYTES = 512 * 1024;

/** What the client sends. */
export interface ReportBody {
  readonly text: string;
  /** The table the player was at, for the server to attach its record. */
  readonly room?: string;
  /** Anything that helps find the bug, as JSON; nothing is required. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/** One seat of a table, as a report carries it: everything but its token. */
export interface ReportSeat {
  readonly seat: number;
  readonly name: string;
  readonly left: boolean;
  readonly connected: boolean;
  readonly host: boolean;
  readonly userId?: string;
  readonly avatar?: Avatar;
  readonly bot?: true;
  readonly botLevel?: BotLevel;
  readonly disconnectedAt?: number | null;
}

/**
 * A table's whole record, as the server attaches it: enough to replay the game
 * exactly (`config`, `seed`, `firstSeat`, `actions`) and to see where it stood.
 * No seat's token: who is ready or went on is said by seat.
 */
export interface ReportTableRecord {
  readonly code: string;
  readonly uid: string;
  readonly config: RulesConfig;
  readonly seed: number;
  /** The seat that took the match's first turn; absent until dealt. */
  readonly firstSeat?: number;
  readonly createdAt: number;
  readonly started: boolean;
  readonly hostSeat: number;
  readonly players: readonly ReportSeat[];
  readonly pausedSeat: number | null;
  readonly idlePaused: boolean;
  readonly pausedSince: number | null;
  readonly savedUntil: number | null;
  readonly nextRoundReady: readonly number[];
  readonly wentOn: readonly number[];
  readonly nextRoomId: string | null;
  /** Every move of the match, oldest first, with who or what made it. */
  readonly actions: readonly LoggedAction[];
  /** The whole game as it stands, every hand included; null before the deal. */
  readonly state: GameState | null;
  readonly chat: readonly ChatMessage[];
}

/** What the server could attach of the table a report names. */
export type ReportTable =
  | { readonly code: string; readonly attached: true; readonly record: ReportTableRecord }
  | { readonly code: string; readonly attached: false; readonly reason: string };

/** A report as kept and read back. */
export interface BugReport {
  /** Numbered in the order reports arrive, from 0. */
  readonly id: number;
  /** When it arrived, in milliseconds since the epoch. */
  readonly at: number;
  readonly text: string;
  readonly context: Readonly<Record<string, unknown>>;
  /** The table's record, or why it is missing. Absent when the report named no table. */
  readonly table?: ReportTable;
  /** What was cut to fit `MAX_REPORT_BYTES`, largest first. Absent when nothing was. */
  readonly truncated?: readonly Truncation[];
}

/** One read of the kept reports: `GET /api/reports?since=<ms>&after=<id>`. */
export interface ReportsPage {
  /** Oldest first. */
  readonly reports: readonly BugReport[];
  /** Whether more are kept after the last of these: ask again with its number as `after`. */
  readonly more: boolean;
}

/** The server's refusals of a report. */
export const REPORT_EMPTY = "say what went wrong";
export const REPORT_TOO_LONG = `that report is longer than ${REPORT_TEXT_MAX} characters`;
export const REPORT_TOO_LARGE = "that report has too much attached";
export const REPORT_UNREADABLE = "that report could not be read";

/** Bytes of a value as UTF-8 JSON, which is what every report cap is measured in. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

// ------------------------------------------------------------------ secrets ---

/**
 * Keys whose values are secrets wherever they appear: a seat's token, an
 * identity's secret, a password, an auth header.
 */
export const SECRET_KEY = /token|secret|password|passwd|authorization|cookie/i;
/** What a secret is replaced with. */
export const REMOVED = "[removed]";
/** Shorter strings are never searched for: a one-letter "secret" would blank everything. */
const MIN_SECRET_LENGTH = 8;
/** Deeper than any real report; past it a value is dropped rather than walked. */
const MAX_DEPTH = 64;

type Walk = (key: string, value: unknown) => unknown;

function walk(value: unknown, visit: Walk, depth = 0): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (depth > MAX_DEPTH) return REMOVED;
  if (Array.isArray(value))
    return value.map((item, i) => visit(String(i), walk(item, visit, depth + 1)));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = visit(key, SECRET_KEY.test(key) ? child : walk(child, visit, depth + 1));
  }
  return out;
}

function stringsIn(value: unknown, into: Set<string>, depth = 0): void {
  if (typeof value === "string") {
    if (value.length >= MIN_SECRET_LENGTH) into.add(value);
  } else if (typeof value === "object" && value !== null && depth <= MAX_DEPTH) {
    for (const child of Object.values(value)) stringsIn(child, into, depth + 1);
  }
}

/** Every string held under a secret's key in `value`, at any depth. */
export function secretsIn(value: unknown): string[] {
  const found = new Set<string>();
  walk(value, (key, child) => {
    if (SECRET_KEY.test(key)) stringsIn(child, found);
    return child;
  });
  return [...found];
}

/**
 * A copy of `value` with no secret in it. First every value under a secret key
 * (`SECRET_KEY`) becomes `REMOVED`; then every other string, and every key, that
 * contains one of those values, or one of `known`, has it cut out. So a token
 * kept under `token` in one place is also gone from a console line or a frame
 * that quoted it elsewhere.
 */
export function scrubSecrets<T>(value: T, known: readonly string[] = []): T {
  const found = new Set<string>();
  for (const secret of known) if (typeof secret === "string") stringsIn(secret, found);
  const keyed = walk(value, (key, child) => {
    if (!SECRET_KEY.test(key)) return child;
    stringsIn(child, found);
    return REMOVED;
  });
  if (found.size === 0) return keyed as T;
  // Longest first, so a secret that contains another is cut whole.
  const secrets = [...found].sort((a, b) => b.length - a.length);
  const cut = (text: string): string =>
    secrets.reduce((out, secret) => out.split(secret).join(REMOVED), text);
  const deep = (item: unknown, depth = 0): unknown => {
    if (typeof item === "string") return cut(item);
    if (typeof item !== "object" || item === null) return item;
    if (depth > MAX_DEPTH) return REMOVED;
    if (Array.isArray(item)) return item.map((child) => deep(child, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item)) out[cut(key)] = deep(child, depth + 1);
    return out;
  };
  return deep(keyed) as T;
}

// ----------------------------------------------------------------- trimming ---

/** One section of a report cut to make it fit. */
export interface Truncation {
  /** Where it was, as a dotted path: `logs.frames`, `table.record.actions`. */
  readonly section: string;
  /** Its size before, in bytes of JSON. */
  readonly bytes: number;
  /**
   * For a list cut short: how many entries are left, of how many. Absent when
   * the whole section was replaced by `TRUNCATED`.
   */
  readonly kept?: number;
  readonly of?: number;
}

/** What a section too large to keep is replaced with. */
export const TRUNCATED = "[truncated: too large for the report]";
const TRUNCATED_BYTES = jsonBytes(TRUNCATED);
/** `,"truncated":`, the bytes the list of cuts adds besides itself. */
const MARK_BYTES = jsonBytes(",") + jsonBytes("truncated") + 1;

/** Which parts of a value may be cut, and in what order. */
export interface FitPlan {
  /**
   * Objects, by path from the root, each of whose properties may be cut, the
   * largest first wherever it is. A path listed here is never cut whole itself.
   */
  readonly sections: readonly (readonly string[])[];
  /**
   * Properties cut only once nothing else is left, in this order. A list here
   * keeps its start (a replayable prefix of moves), where any other keeps its end
   * (the newest).
   */
  readonly last?: readonly (readonly string[])[];
}

interface Cut {
  readonly path: readonly string[];
  bytes: number;
  readonly keepStart: boolean;
}

function getAt(root: unknown, path: readonly string[]): unknown {
  let at = root;
  for (const key of path) {
    if (typeof at !== "object" || at === null || !Object.hasOwn(at, key)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

function setAt(root: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path as [string, ...string[]];
  const node = root as Record<string, unknown>;
  return { ...node, [key]: setAt(node[key], rest, value) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `value` cut down until it is at most `max` bytes of JSON, with a `truncated`
 * list at its root saying what went. The largest section in `plan.sections` goes
 * first: a list loses entries (its oldest) until it is no larger than the next
 * section or the whole fits; anything else, and a list down to one entry, is
 * replaced by `TRUNCATED`. Then `plan.last`, in order. A value that cannot fit
 * even then is answered as far as it went, for the caller to refuse.
 */
export function fitToBytes<T extends object>(
  value: T,
  max: number,
  plan: FitPlan,
): { value: T; truncated: Truncation[] } {
  let root: unknown = value;
  let total = jsonBytes(value);
  const truncated: Truncation[] = [];
  const over = (): number =>
    total + (truncated.length > 0 ? MARK_BYTES + jsonBytes(truncated) : 0) - max;
  if (over() <= 0) return { value, truncated };

  const containers = new Set(plan.sections.map((path) => path.join(".")));
  const last = (plan.last ?? []).map((path) => [...path]);
  const lastKeys = new Set(last.map((path) => path.join(".")));
  const open: Cut[] = [];
  for (const path of plan.sections) {
    const container = getAt(root, path);
    if (!isObject(container)) continue;
    for (const [key, child] of Object.entries(container)) {
      const dotted = [...path, key].join(".");
      if (child === undefined || containers.has(dotted) || lastKeys.has(dotted)) continue;
      if (path.length === 0 && key === "truncated") continue;
      const bytes = jsonBytes(child);
      if (bytes > TRUNCATED_BYTES) open.push({ path: [...path, key], bytes, keepStart: false });
    }
  }

  const note = (cut: Cut, before: number, kept?: number, of?: number): void => {
    const section = cut.path.join(".");
    const index = truncated.findIndex((t) => t.section === section);
    // A section cut again keeps the size and length it had before its first cut.
    const first = index < 0 ? undefined : truncated[index]!;
    const bytes = first?.bytes ?? before;
    const entry: Truncation =
      kept === undefined ? { section, bytes } : { section, bytes, kept, of: first?.of ?? of };
    if (index < 0) truncated.push(entry);
    else truncated[index] = entry;
  };

  /** Cut `cut` once, no further than `floor` bytes. Answers whether it can be cut again. */
  const cutOnce = (cut: Cut, floor: number): boolean => {
    const current = getAt(root, cut.path);
    const before = cut.bytes;
    if (Array.isArray(current) && current.length > 1) {
      const sizes = current.map((item) => jsonBytes(item ?? null) + 1);
      const need = over();
      let removed = 0;
      let drop = 0;
      while (
        drop < current.length - 1 &&
        (drop === 0 || (removed < need && before - removed > floor))
      ) {
        removed += sizes[cut.keepStart ? current.length - 1 - drop : drop]!;
        drop++;
      }
      const left = cut.keepStart ? current.slice(0, current.length - drop) : current.slice(drop);
      root = setAt(root, cut.path, left);
      const after = jsonBytes(left);
      total += after - before;
      cut.bytes = after;
      note(cut, before, left.length, current.length);
      return left.length > 1 || after > TRUNCATED_BYTES;
    }
    root = setAt(root, cut.path, TRUNCATED);
    total += TRUNCATED_BYTES - before;
    cut.bytes = TRUNCATED_BYTES;
    note(cut, before);
    return false;
  };

  while (over() > 0 && open.length > 0) {
    open.sort((a, b) => b.bytes - a.bytes);
    const largest = open[0]!;
    if (!cutOnce(largest, open[1]?.bytes ?? 0)) open.shift();
  }
  for (const path of last) {
    const current = getAt(root, path);
    if (current === undefined) continue;
    const cut: Cut = { path, bytes: jsonBytes(current), keepStart: true };
    if (cut.bytes <= TRUNCATED_BYTES) continue;
    while (over() > 0 && cutOnce(cut, 0));
  }
  if (truncated.length === 0) return { value, truncated };
  return { value: { ...(root as object), truncated } as T, truncated };
}
