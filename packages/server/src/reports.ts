/**
 * Bug reports from players: the checks every host makes before keeping one, the
 * table's record a host attaches to it, the in-memory store the Node host keeps
 * them in, and the Markdown and replay file a developer reads them as.
 *
 * Kept by the game itself rather than filed as GitHub issues: the repository is
 * public, and a report carries names, room codes, every card at the table and
 * what each player did. Only the newest `REPORTS_KEPT` are kept, so a flood of
 * reports pushes out old ones instead of growing storage without end.
 */
import type { GameLog } from "@hf/engine";
import {
  fitToBytes,
  jsonBytes,
  MAX_REPORT_BODY_BYTES,
  MAX_REPORT_BYTES,
  REPORT_EMPTY,
  REPORT_TEXT_MAX,
  REPORT_TOO_LARGE,
  REPORT_TOO_LONG,
  REPORT_UNREADABLE,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  scrubSecrets,
  type Ack,
  type BugReport,
  type ReportTable,
  type ReportTableRecord,
  type Truncation,
} from "@hf/shared";
import type { Room } from "./room";

/**
 * Reports kept at once; the oldest goes first. At most `MAX_REPORT_BYTES` each,
 * so the store never holds more than 100 MB, and in practice a few MB.
 */
export const REPORTS_KEPT = 200;
/** Reports answered by one read, at most 8 MB; a reader asks again for the rest. */
export const REPORTS_PER_READ = 16;

/** A report as checked, before a store numbers it and before a table is attached. */
export interface ReportDraft {
  readonly at: number;
  readonly text: string;
  readonly context: Readonly<Record<string, unknown>>;
  /** The table it names, as a well-formed code, for the host to attach; null for none. */
  readonly room: string | null;
}

/** A report ready to keep: everything but its number. */
export type ReportEntry = Omit<BugReport, "id">;

/** A table code as a report names it, in capitals, or null when it is not one. */
export function reportRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return [...code].every((c) => ROOM_CODE_ALPHABET.includes(c)) ? code : null;
}

/**
 * A report from an untyped request body, or the reason it is refused. The text is
 * trimmed and required; the attachment, if any, must be a JSON object, and the
 * two together must fit in `MAX_REPORT_BODY_BYTES`. Anything under a secret's
 * key in the attachment is removed (`scrubSecrets`), whatever the client did.
 */
export function parseReport(body: unknown, now: number): Ack<ReportDraft> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: REPORT_UNREADABLE };
  }
  const { text, context, room } = body as Record<string, unknown>;
  if (typeof text !== "string") return { ok: false, error: REPORT_EMPTY };
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: REPORT_EMPTY };
  if (trimmed.length > REPORT_TEXT_MAX) return { ok: false, error: REPORT_TOO_LONG };
  if (
    context !== undefined &&
    context !== null &&
    (typeof context !== "object" || Array.isArray(context))
  ) {
    return { ok: false, error: REPORT_UNREADABLE };
  }
  const sent = { at: now, text: trimmed, context: (context ?? {}) as Record<string, unknown> };
  if (jsonBytes(sent) > MAX_REPORT_BODY_BYTES) return { ok: false, error: REPORT_TOO_LARGE };
  return {
    ok: true,
    data: { ...sent, context: scrubSecrets(sent.context), room: reportRoomCode(room) },
  };
}

/** A table's record for a report, and the seat tokens that must not appear in it. */
export interface TableForReport {
  readonly record: ReportTableRecord;
  /** Every seat's token, so the report can be searched for them; never kept. */
  readonly tokens: readonly string[];
}

/**
 * Everything a table knows, for a report: its record, every move, the whole game
 * state and its chat, with each seat's token left out (who is ready or went on
 * is said by seat). What a developer needs to replay the game exactly.
 */
export function tableForReport(room: Room): TableForReport {
  const record = room.record();
  const seats = room.seats();
  const seatOfToken = (token: string): number => seats.find((p) => p.token === token)?.seat ?? -1;
  const hostSeat = room.hostSeat;
  return {
    record: {
      code: record.id,
      uid: record.uid,
      config: record.config,
      seed: record.seed,
      ...(record.firstSeat !== undefined ? { firstSeat: record.firstSeat } : {}),
      createdAt: record.createdAt,
      started: record.started,
      hostSeat,
      players: seats.map((p) => ({
        seat: p.seat,
        name: p.name,
        left: p.left,
        connected: p.connected,
        host: p.seat === hostSeat,
        ...(p.userId ? { userId: p.userId } : {}),
        ...(p.avatar ? { avatar: p.avatar } : {}),
        ...(p.bot ? { bot: true as const, botLevel: p.botLevel } : {}),
        ...(p.bot ? {} : { disconnectedAt: p.disconnectedAt }),
      })),
      pausedSeat: record.pausedSeat,
      idlePaused: record.idlePaused ?? false,
      pausedSince: record.pausedSince ?? null,
      savedUntil: record.savedUntil ?? null,
      nextRoundReady: (record.nextRoundReady ?? []).map(seatOfToken),
      wentOn: (record.wentOn ?? []).map(seatOfToken),
      nextRoomId: record.nextRoomId ?? null,
      actions: [...room.log.entries()],
      state: room.gameState,
      chat: [...room.chatHistory()],
    },
    tokens: seats.map((p) => p.token),
  };
}

/** The plan `fitToBytes` cuts a kept report by: the client's sections, then the table's. */
function entryPlan(entry: ReportEntry): Parameters<typeof fitToBytes>[2] {
  const sections: string[][] = [["context"]];
  for (const [key, value] of Object.entries(entry.context)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sections.push(["context", key]);
    }
  }
  sections.push(["table", "record"]);
  // The moves and the state are what replay the game: cut only when nothing else
  // is left, the moves first (keeping their start, which still replays), since
  // the state alone still shows where the game stood; the seats and the rules,
  // without which neither means anything, after those.
  return {
    sections,
    last: [
      ["table", "record", "actions"],
      ["table", "record", "state"],
      ["table", "record", "players"],
      ["table", "record", "config"],
    ],
  };
}

/**
 * The report to keep: the draft with the table attached (or why it is not), no
 * seat token of that table anywhere in it, cut to `MAX_REPORT_BYTES` with what
 * was cut listed in `truncated`. Answers null if even that does not fit.
 */
export function reportEntry(
  draft: ReportDraft,
  table: ReportTable | null,
  tokens: readonly string[] = [],
): ReportEntry | null {
  const scrubbed = scrubSecrets(
    { at: draft.at, text: draft.text, context: draft.context, ...(table ? { table } : {}) },
    tokens,
  );
  const fitted = fitToBytes<ReportEntry>(scrubbed, MAX_REPORT_BYTES, entryPlan(scrubbed));
  return jsonBytes(fitted.value) > MAX_REPORT_BYTES ? null : fitted.value;
}

/** What a report says when the table it names could not be attached. */
export const NO_TABLE = "no table with that code is open now";
export const TABLE_UNREACHABLE = "the table did not answer";

/** Where reports are kept. */
export interface ReportStore {
  /** Keep a report, numbered after the last, dropping the oldest past the cap. */
  add(entry: ReportEntry): Promise<BugReport>;
  /**
   * Kept reports that arrived after `at` and are numbered above `after`, oldest
   * first, at most `REPORTS_PER_READ` of them.
   */
  since(at: number, after?: number): Promise<readonly BugReport[]>;
}

/** The Node host's store: memory only, so a restart forgets the reports. */
export class InMemoryReportStore implements ReportStore {
  private readonly kept: BugReport[] = [];
  private next = 0;

  async add(entry: ReportEntry): Promise<BugReport> {
    const report: BugReport = { id: this.next++, ...entry };
    this.kept.push(report);
    if (this.kept.length > REPORTS_KEPT) this.kept.shift();
    return report;
  }

  async since(at: number, after = -1): Promise<readonly BugReport[]> {
    return this.kept
      .filter((report) => report.at > at && report.id > after)
      .slice(0, REPORTS_PER_READ);
  }
}

/** The `since` query parameter: a whole number of milliseconds, else 0 (everything). */
export function parseSince(raw: string | null): number {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0;
}

/** The `after` query parameter: a report number, else -1 (from the first). */
export function parseAfter(raw: string | null): number {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : -1;
}

/**
 * Whether an Authorization header carries `Bearer <token>`. Compared without
 * stopping at the first difference, so the time an answer takes says nothing
 * about how much of a guess was right.
 */
export function bearerMatches(header: string | null | undefined, token: string): boolean {
  const expected = `Bearer ${token}`;
  if (typeof header !== "string" || header.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

// ------------------------------------------------------------------ reading ---

/**
 * A report's game as the engine replays it: `buildTimeline(log)` in a test or the
 * scenario viewer, or `replay(setup.seed, setup.playerCount, config, actions,
 * setup.firstSeat)`. Null when no table was attached or it had not dealt.
 */
export function reportReplay(report: BugReport): GameLog | null {
  const table = report.table;
  if (!table?.attached || !table.record.started) return null;
  const record = table.record;
  return {
    config: record.config,
    setup: {
      seed: record.seed,
      playerCount: record.players.length,
      firstSeat: record.firstSeat ?? 0,
    },
    actions: Array.isArray(record.actions) ? record.actions.map((row) => row.action) : [],
    names: record.players.map((p) => p.name),
  };
}

function kilobytes(value: unknown): string {
  return `${Math.max(1, Math.round(jsonBytes(value) / 1024))} KB`;
}

/** JSON in a fence longer than any run of backticks inside, so the JSON cannot end it. */
function fenced(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  const longest = Math.max(0, ...(json.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}json\n${json}\n${fence}`;
}

/** A folded block: GitHub and most Markdown viewers show only its summary until opened. */
function folded(title: string, value: unknown): string {
  return `<details><summary>${title} (${kilobytes(value)})</summary>\n\n${fenced(value)}\n\n</details>`;
}

function line(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return `- **${label}:** ${typeof value === "string" ? value : JSON.stringify(value)}`;
}

function tableLine(table: ReportTable | undefined): string | null {
  if (!table) return null;
  if (!table.attached) return line("Table record", `${table.code}, not attached: ${table.reason}`);
  const record = table.record;
  const state = record.state;
  const moves = Array.isArray(record.actions) ? `${record.actions.length} moves` : "moves cut";
  const where =
    state && typeof state === "object"
      ? `, round ${state.roundNumber}, ${state.phase} phase, seat ${state.currentSeat} to play`
      : "";
  return line(
    "Table record",
    `${table.code}, attached: ${record.players.length} seats, seed ${record.seed}, ${moves}${where}`,
  );
}

function truncationLine(truncated: readonly Truncation[] | undefined): string | null {
  if (!truncated?.length) return null;
  return line(
    "Truncated to fit",
    truncated
      .map((t) =>
        t.kept === undefined
          ? `${t.section} (all ${t.bytes} bytes)`
          : `${t.section} (kept ${t.kept} of ${t.of})`,
      )
      .join("; "),
  );
}

/**
 * One report as Markdown: a summary first (what the player wrote, where and when,
 * whether the table's record came with it, anything cut), then every section of
 * the attachment and the table's record folded, largest last read.
 */
export function reportMarkdown(report: BugReport): string {
  const quoted = report.text
    .split("\n")
    .map((text) => (text === "" ? ">" : `> ${text}`))
    .join("\n");
  const summary = report.context.summary;
  const facts =
    typeof summary === "object" && summary !== null && !Array.isArray(summary)
      ? Object.entries(summary).map(([key, value]) => line(key, value))
      : [];
  const clientCut = report.context.truncated as readonly Truncation[] | undefined;
  const lines = [
    ...facts,
    tableLine(report.table),
    truncationLine(report.truncated),
    clientCut ? truncationLine(clientCut)?.replace("Truncated to fit", "Cut by the client") : null,
  ].filter((text): text is string => text !== null);
  const blocks: string[] = [];
  for (const [key, value] of Object.entries(report.context)) {
    if (key === "summary" || key === "truncated") continue;
    blocks.push(folded(`context.${key}`, value));
  }
  const table = report.table;
  if (table?.attached) {
    for (const [key, value] of Object.entries(table.record)) {
      if (typeof value === "object" && value !== null) blocks.push(folded(`table.${key}`, value));
    }
  }
  const head = `## Report ${report.id}, ${new Date(report.at).toISOString()}\n\n${quoted}`;
  return [head, lines.join("\n"), ...blocks].filter(Boolean).join("\n\n") + "\n";
}

/** The reports as Markdown, oldest first, for a person or an agent to triage. */
export function reportsMarkdown(reports: readonly BugReport[]): string {
  if (reports.length === 0) return "No bug reports.\n";
  return reports.map(reportMarkdown).join("\n");
}
