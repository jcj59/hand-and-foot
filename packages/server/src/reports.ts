/**
 * Bug reports from players: the checks every host makes before keeping one, the
 * in-memory store the Node host keeps them in, and the Markdown a person reads
 * them as.
 *
 * Kept by the game itself rather than filed as GitHub issues: the repository is
 * public, and a report carries names, room codes and what a table was doing.
 * Only the newest `REPORTS_KEPT` are kept, so a flood of reports pushes out old
 * ones instead of growing storage without end.
 */
import {
  MAX_REPORT_BYTES,
  REPORT_EMPTY,
  REPORT_TEXT_MAX,
  REPORT_TOO_LARGE,
  REPORT_TOO_LONG,
  REPORT_UNREADABLE,
  type Ack,
  type BugReport,
} from "@hf/shared";

/** Reports kept at once; the oldest goes first. */
export const REPORTS_KEPT = 500;

/** A report as checked, before a store numbers it. */
export type ReportDraft = Omit<BugReport, "id">;

/** Bytes of a value as UTF-8 JSON, which is what the size cap is measured in. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * A report from an untyped request body, or the reason it is refused. The text is
 * trimmed and required; the attachment, if any, must be a JSON object, and the
 * two together must fit in `MAX_REPORT_BYTES`.
 */
export function parseReport(body: unknown, now: number): Ack<ReportDraft> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: REPORT_UNREADABLE };
  }
  const { text, context } = body as Record<string, unknown>;
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
  const draft: ReportDraft = {
    at: now,
    text: trimmed,
    context: (context ?? {}) as Record<string, unknown>,
  };
  if (jsonBytes(draft) > MAX_REPORT_BYTES) return { ok: false, error: REPORT_TOO_LARGE };
  return { ok: true, data: draft };
}

/** Where reports are kept. */
export interface ReportStore {
  /** Keep a report, numbered after the last, dropping the oldest past the cap. */
  add(draft: ReportDraft): Promise<BugReport>;
  /** Every kept report that arrived after `at`, oldest first. */
  since(at: number): Promise<readonly BugReport[]>;
}

/** The Node host's store: memory only, so a restart forgets the reports (they are also logged). */
export class InMemoryReportStore implements ReportStore {
  private readonly kept: BugReport[] = [];
  private next = 0;

  async add(draft: ReportDraft): Promise<BugReport> {
    const report: BugReport = { id: this.next++, ...draft };
    this.kept.push(report);
    if (this.kept.length > REPORTS_KEPT) this.kept.shift();
    return report;
  }

  async since(at: number): Promise<readonly BugReport[]> {
    return this.kept.filter((report) => report.at > at);
  }
}

/** The `since` query parameter: a whole number of milliseconds, else 0 (everything). */
export function parseSince(raw: string | null): number {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0;
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

/** The reports as Markdown, oldest first, for a person or an agent to triage. */
export function reportsMarkdown(reports: readonly BugReport[]): string {
  if (reports.length === 0) return "No bug reports.\n";
  return reports
    .map((report) => {
      const quoted = report.text
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
      const json = JSON.stringify(report.context, null, 2);
      // A fence longer than any run of backticks inside, so the details cannot end it.
      const longest = Math.max(0, ...(json.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      const details = Object.keys(report.context).length
        ? `\n\n${fence}json\n${json}\n${fence}`
        : "";
      return `## Report ${report.id}, ${new Date(report.at).toISOString()}\n\n${quoted}${details}\n`;
    })
    .join("\n");
}
