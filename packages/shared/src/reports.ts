// Bug reports from players: what the client sends and what the game keeps.
//
// A report is what the player wrote plus whatever the client attached to help
// find the bug (where they were, what the table was doing, recent errors). The
// server checks only the shape and the size of the attachment, never its
// contents: it is read by a person (or an agent) triaging bugs, not by the game.

/** Send a report: POST `{ text, context? }`. Reading them back is GET, with a token. */
export const REPORTS_PATH = "/api/reports";

/** The most a player may write, in characters, after trimming. */
export const REPORT_TEXT_MAX = 2000;
/** The most a whole report (text and attachment) may be, in bytes of JSON. */
export const MAX_REPORT_BYTES = 8 * 1024;

/** What the client sends. */
export interface ReportBody {
  readonly text: string;
  /** Anything that helps find the bug, as JSON; nothing is required. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/** A report as kept and read back. */
export interface BugReport {
  /** Numbered in the order reports arrive, from 0. */
  readonly id: number;
  /** When it arrived, in milliseconds since the epoch. */
  readonly at: number;
  readonly text: string;
  readonly context: Readonly<Record<string, unknown>>;
}

/** The server's refusals of a report. */
export const REPORT_EMPTY = "say what went wrong";
export const REPORT_TOO_LONG = `that report is longer than ${REPORT_TEXT_MAX} characters`;
export const REPORT_TOO_LARGE = "that report has too much attached";
export const REPORT_UNREADABLE = "that report could not be read";
