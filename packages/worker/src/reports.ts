/**
 * Players' bug reports, kept in one Durable Object for the whole game.
 *
 * One object rather than one per player: reports are read all together, by the
 * person fixing bugs, and there are few of them. Each report is its own key,
 * numbered in order, so keeping one is a single write and dropping the oldest
 * past `REPORTS_KEPT` is a single delete, however many are kept. What a report
 * may hold is checked before it gets here (`parseReport` in `@hf/server/core`).
 */
import { DurableObject } from "cloudflare:workers";
import { REPORTS_KEPT, type ReportDraft } from "@hf/server/core";
import type { BugReport } from "@hf/shared";
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
   * Keep a report under the next number, and drop the one that is now past the
   * cap. Answers the number (the whole report would not type as an RPC result:
   * its attachment is untyped JSON).
   */
  add(draft: ReportDraft): number {
    const kv = this.ctx.storage.kv;
    const id = kv.get<number>(NEXT) ?? 0;
    const report: BugReport = { id, ...draft };
    kv.put(keyOf(id), report);
    kv.put(NEXT, id + 1);
    if (id >= REPORTS_KEPT) kv.delete(keyOf(id - REPORTS_KEPT));
    return id;
  }

  /** Every kept report that arrived after `at`, oldest first. */
  since(at: number): BugReport[] {
    const kept = this.ctx.storage.kv.list<BugReport>({ prefix: REPORT });
    return [...kept].map(([, report]) => report).filter((report) => report.at > at);
  }
}
