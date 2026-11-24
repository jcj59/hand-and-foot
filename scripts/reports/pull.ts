/**
 * Fetch the players' bug reports, for a person or an agent to triage.
 *
 *   REPORTS_TOKEN=<token> pnpm reports:pull --url https://<the game's host> [--since <time>]
 *     Prints every report as Markdown: a summary first, each section folded.
 *   ... --out <dir>
 *     Writes each report as <dir>/report-<id>.md, the whole of it as
 *     report-<id>.json, and, when its table's record came with it,
 *     report-<id>.replay.json; prints one line per report.
 *   ... --replay <id> [--out <file>]
 *     Prints (or writes) report <id>'s game as a replayable `GameLog`
 *     ({ config, setup: { seed, playerCount, firstSeat }, actions, names }), for
 *     `buildTimeline` in a test or the scenario viewer's `/scenarios/report`.
 *
 * `--url` (or `HF_REPORTS_URL`) is where the game is served; `--since` is a time
 * in milliseconds or anything `Date` reads (`2026-11-20`), and only reports after
 * it are fetched. The token is the Worker's `REPORTS_TOKEN` secret (see
 * CLAUDE.md). Reports come 16 at a time, each read one request to the reports
 * Durable Object.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Ack, BugReport, ReportsPage } from "../../packages/shared/src/index";
import { reportMarkdown, reportReplay, reportsMarkdown } from "../../packages/server/src/reports";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    since: { type: "string" },
    out: { type: "string" },
    replay: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const base = values.url ?? process.env.HF_REPORTS_URL;
if (!base) fail("say where the game is served: --url https://... (or HF_REPORTS_URL)");
const token = process.env.REPORTS_TOKEN;
if (!token) fail("set REPORTS_TOKEN to the Worker's reports token");

let since = 0;
if (values.since !== undefined) {
  since = /^\d+$/.test(values.since) ? Number(values.since) : Date.parse(values.since);
  if (Number.isNaN(since)) fail(`--since is not a time: ${values.since}`);
}
const wanted = values.replay === undefined ? null : Number(values.replay);
if (wanted !== null && !Number.isInteger(wanted)) fail(`--replay is not a report number`);

/** One page of reports after report `after`. */
async function page(after: number): Promise<ReportsPage> {
  const url = new URL("/api/reports", base);
  url.searchParams.set("since", String(since));
  url.searchParams.set("after", String(after));
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 404)
    fail("this host does not serve reports (is REPORTS_TOKEN set on it?)");
  if (response.status === 401) fail("that is not this host's reports token");
  const answer = (await response.json()) as Ack<ReportsPage>;
  if (!answer.ok) fail(answer.error);
  return answer.data;
}

// Asked for one report: start just before it, and stop at the first page.
const reports: BugReport[] = [];
for (let after = wanted === null ? -1 : wanted - 1; ;) {
  const { reports: some, more } = await page(after);
  reports.push(...some);
  if (!more || some.length === 0 || wanted !== null) break;
  after = some[some.length - 1]!.id;
}

if (wanted !== null) {
  const report = reports.find((r) => r.id === wanted);
  if (!report) fail(`no report ${wanted} is kept${since ? " after --since" : ""}`);
  const log = reportReplay(report);
  if (!log) {
    const table = report.table;
    fail(
      table && !table.attached
        ? `report ${wanted}'s table record is missing: ${table.reason}`
        : `report ${wanted} has no dealt table to replay`,
    );
  }
  const json = `${JSON.stringify(log, null, 2)}\n`;
  if (values.out) {
    writeFileSync(values.out, json);
    console.log(`wrote ${values.out} (${log.actions.length} moves)`);
  } else {
    process.stdout.write(json);
  }
} else if (values.out) {
  mkdirSync(values.out, { recursive: true });
  for (const report of reports) {
    const name = join(values.out, `report-${report.id}`);
    writeFileSync(`${name}.md`, reportMarkdown(report));
    writeFileSync(`${name}.json`, `${JSON.stringify(report, null, 2)}\n`);
    const log = reportReplay(report);
    if (log) writeFileSync(`${name}.replay.json`, `${JSON.stringify(log, null, 2)}\n`);
    const first = report.text.split("\n")[0]!.slice(0, 80);
    console.log(`${name}.md${log ? " (+ replay)" : ""}: ${first}`);
  }
  if (reports.length === 0) console.log("No bug reports.");
} else {
  process.stdout.write(reportsMarkdown(reports));
}
