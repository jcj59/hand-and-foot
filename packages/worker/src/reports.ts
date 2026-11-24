/**
 * Players' bug reports, kept in one Durable Object for the whole game.
 *
 * One object rather than one per player: reports are read all together, by the
 * person fixing bugs, and there are few of them. Each report is its own key,
 * numbered in order, so keeping one is a single write and dropping the oldest
 * past `REPORTS_KEPT` is a single delete, however many are kept. What a report
 * may hold is checked before it gets here (`parseReport` in `@hf/server/core`).
 *
 * A report that names a table gets that table's whole record attached here, by
 * asking the table's own object (`TableObject.reportRecord`): one more Durable
 * Object request, so a report from a table costs two and one from anywhere else
 * one. Asked here rather than in the Worker so that fitting a report of up to
 * half a megabyte runs in an object, whose CPU allowance is far larger than a
 * free-plan Worker request's. If the table is gone or does not answer, the report
 * is kept anyway and says why its record is missing.
 */
import { DurableObject } from "cloudflare:workers";
import {
  NO_TABLE,
  REPORTS_KEPT,
  REPORTS_PER_READ,
  reportEntry,
  TABLE_UNREACHABLE,
  type ReportDraft,
  type TableForReport,
} from "@hf/server/core";
import type { BugReport, ReportsPage, ReportTable } from "@hf/shared";
import type { Env } from "./env";

/** The one object's name. */
export const REPORTS_OBJECT = "reports";

const NEXT = "next";
const REPORT = "report:";

/** A report's key: its number, padded so keys list in the order reports arrived. */
function keyOf(id: number): string {
  return `${REPORT}${String(id).padStart(12, "0")}`;
}

export class ReportsObject extends DurableObject<Env> {
  /**
   * Attach the table the draft names, then keep the report under the next
   * number and drop the one that is now past the cap. Answers the number, or
   * null when the report cannot be made to fit (the whole report would not type
   * as an RPC result: its attachment is untyped JSON).
   */
  async add(draft: ReportDraft): Promise<number | null> {
    let table: ReportTable | null = null;
    let tokens: readonly string[] = [];
    if (draft.room !== null) {
      const code = draft.room;
      let found: TableForReport | null = null;
      let reason = NO_TABLE;
      try {
        found = (await this.env.TABLES.getByName(code).reportRecord()) as TableForReport | null;
      } catch (error) {
        reason = `${TABLE_UNREACHABLE}: ${error instanceof Error ? error.message : String(error)}`;
      }
      table = found
        ? { code, attached: true, record: found.record }
        : { code, attached: false, reason };
      tokens = found?.tokens ?? [];
    }
    const entry = reportEntry(draft, table, tokens);
    if (!entry) return null;
    // Numbered only now, after the table answered: the await above lets another
    // report in, and each must take its own number.
    const kv = this.ctx.storage.kv;
    const id = kv.get<number>(NEXT) ?? 0;
    const report: BugReport = { id, ...entry };
    kv.put(keyOf(id), report);
    kv.put(NEXT, id + 1);
    if (id >= REPORTS_KEPT) kv.delete(keyOf(id - REPORTS_KEPT));
    return id;
  }

  /**
   * Kept reports that arrived after `at` and are numbered above `after`, oldest
   * first, at most `REPORTS_PER_READ`; `more` says whether to ask again from the
   * last one's number.
   */
  since(at: number, after = -1): ReportsPage {
    const reports: BugReport[] = [];
    const start = keyOf(Math.max(0, after + 1));
    for (const [, report] of this.ctx.storage.kv.list<BugReport>({ prefix: REPORT, start })) {
      if (report.at <= at) continue;
      if (reports.length === REPORTS_PER_READ) return { reports, more: true };
      reports.push(report);
    }
    return { reports, more: false };
  }
}
