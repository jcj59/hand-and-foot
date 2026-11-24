/**
 * "Report a bug": a sheet where a player says what went wrong, sees exactly
 * what is sent with it, and sends it once.
 *
 * Opened from the table's menu (with the table's details, which the player can
 * leave out) and from Profile (without). What is attached is read as the sheet
 * opens and shown both as a list in words and, folded, as the very JSON that
 * goes, so nothing is sent the player could not have read first. The answer,
 * thanks or the server's refusal, is shown in the sheet.
 */
import { useId, useMemo, useState } from "react";
import { REPORT_TEXT_MAX } from "@hf/shared";
import { sendReport } from "../actions";
import { loadAccount, loadIdentity, serverPost, type Post } from "../identity";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { usePhone } from "../usePhone";
import {
  attachmentRows,
  fitReport,
  reportBody,
  reportContext,
  type PageFacts,
  type TableReport,
} from "./context";
import { recentErrors } from "./errors";

/** The build this page came from: the git short sha, set by Vite at build time. */
const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "unknown";

function pageFacts(phone: boolean): PageFacts {
  return {
    build: BUILD_ID,
    at: Date.now(),
    path: window.location.pathname,
    userAgent: window.navigator.userAgent,
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    phone,
    userId: loadIdentity()?.userId ?? null,
    username: loadAccount(),
    errors: recentErrors(),
  };
}

export interface ReportSheetProps {
  /** The table's details, at a table; null elsewhere. */
  readonly table: TableReport | null;
  readonly onClose: () => void;
  readonly post?: Post;
}

type Sending =
  | { readonly state: "writing" }
  | { readonly state: "sending" }
  | { readonly state: "sent"; readonly id: number | null }
  | { readonly state: "refused"; readonly error: string };

export function ReportSheet({
  table,
  onClose,
  post = serverPost(),
}: ReportSheetProps): React.ReactElement {
  const phone = usePhone();
  const ids = useId();
  // Read once, as the sheet opens: the list below is what goes, not what the
  // page has become by the time Send is pressed.
  const [page] = useState(() => pageFacts(phone));
  const [text, setText] = useState("");
  const [leaveOutTable, setLeaveOutTable] = useState(false);
  const [sending, setSending] = useState<Sending>({ state: "writing" });

  const context = useMemo(
    () => reportContext(page, leaveOutTable ? null : table),
    [page, table, leaveOutTable],
  );
  const body = fitReport(text, context);
  const rows = attachmentRows(body.context);
  const empty = text.trim() === "";
  const busy = sending.state === "sending";

  const send = (): void => {
    if (empty || busy) return;
    setSending({ state: "sending" });
    void sendReport(post, reportBody(body)).then((answer) =>
      setSending(
        answer.ok
          ? { state: "sent", id: answer.data.id }
          : { state: "refused", error: answer.error },
      ),
    );
  };

  if (sending.state === "sent") {
    return (
      <Sheet id="report" title="Report a bug" onClose={onClose}>
        <div role="status" className="flex flex-col gap-2">
          <p className="m-0 text-[15px] font-medium text-accent">Thanks, your report was sent.</p>
          <p className="m-0 text-sm text-muted">
            {sending.id === null ? "" : `It is report ${sending.id}. `}
            Whoever fixes bugs will read it with what was attached.
          </p>
        </div>
        <Button onClick={onClose} className="self-start">
          Done
        </Button>
      </Sheet>
    );
  }

  return (
    <Sheet id="report" title="Report a bug" onClose={onClose}>
      <form
        aria-label="Report a bug"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[15px] font-medium">What went wrong?</span>
          <span id={`${ids}-hint`} className="text-sm text-muted">
            Say what you were doing when it happened, and what you expected instead.
          </span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby={`${ids}-hint`}
            required
            maxLength={REPORT_TEXT_MAX}
            rows={phone ? 4 : 5}
            placeholder="I tried to take the pile with two queens and it said…"
            className="resize-y rounded-xl border border-white/16 bg-black/25 px-3 py-2.5 text-[15px] text-ink placeholder:text-faint"
          />
        </label>

        <section aria-labelledby={`${ids}-sent`} className="flex flex-col gap-2">
          <h3
            id={`${ids}-sent`}
            className="m-0 text-xs font-semibold tracking-[0.08em] text-quiet uppercase"
          >
            Sent with your report
          </h3>
          <dl className="m-0 flex flex-col rounded-2xl border border-white/6 bg-surface text-sm">
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={`flex gap-3 px-3.5 py-2 ${index > 0 ? "border-t border-white/5" : ""}`}
              >
                <dt className="w-[84px] shrink-0 text-muted">{row.label}</dt>
                <dd className="m-0 min-w-0 break-words text-ink-soft">{row.value}</dd>
              </div>
            ))}
          </dl>
          {table && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={leaveOutTable}
                onChange={(event) => setLeaveOutTable(event.target.checked)}
                className="size-5 accent-accent"
              />
              Leave out this table&rsquo;s details
            </label>
          )}
          {table && !leaveOutTable && (
            <p className="m-0 text-xs text-quiet">
              Never sent: your cards or anyone else&rsquo;s, only how many you hold.
            </p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Show exactly what is sent</summary>
            <pre
              aria-label="What is sent"
              className="mt-2 max-h-56 overflow-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-snug whitespace-pre-wrap text-ink-soft"
            >
              {JSON.stringify(body.context, null, 2)}
            </pre>
          </details>
        </section>

        {sending.state === "refused" && (
          <p
            role="alert"
            className="m-0 rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft"
          >
            {capitalize(sending.error)}.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={empty || busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
