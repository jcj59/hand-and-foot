/**
 * "Report a bug": a sheet where a player says what went wrong and sends it once.
 *
 * Opened from the table's menu and from Profile. Everything the page knows that
 * could help recreate the bug goes with it automatically (see `context.ts`); the
 * player is told so in one line rather than shown it, since at a table it is the
 * whole game as their screen had it. The facts are read as the sheet opens, so
 * the report is of the moment the player saw the bug, and cleared of secrets and
 * fitted to size as it is sent. The answer, thanks or the server's refusal, is
 * shown in the sheet.
 */
import { useId, useState } from "react";
import { REPORT_TEXT_MAX } from "@hf/shared";
import { sendReport } from "../actions";
import { serverPost, type Post } from "../identity";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { usePhone } from "../usePhone";
import { reportBody, reportContext, type TableReport } from "./context";
import { pageFacts } from "./page";

/** What the sheet says goes with a report, at a table and elsewhere. */
export const TABLE_DISCLOSURE =
  "Your report includes your table\u2019s details so we can reproduce the problem.";
export const PAGE_DISCLOSURE =
  "Your report includes details about this page and device so we can reproduce the problem.";

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
  // Read once, as the sheet opens: the report is of the moment the player saw the
  // bug, not of what the page has become by the time Send is pressed.
  const [page] = useState(() => {
    const facts = pageFacts(phone);
    return { context: reportContext(facts, table), secrets: facts.secrets };
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState<Sending>({ state: "writing" });
  const empty = text.trim() === "";
  const busy = sending.state === "sending";

  const send = (): void => {
    if (empty || busy) return;
    setSending({ state: "sending" });
    void sendReport(post, reportBody(text, page.context, page.secrets)).then((answer) =>
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

        <p className="m-0 text-sm text-muted">{table ? TABLE_DISCLOSURE : PAGE_DISCLOSURE}</p>

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
