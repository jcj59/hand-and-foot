/**
 * Print the players' bug reports as Markdown, for a person or an agent to triage.
 *
 *   REPORTS_TOKEN=<token> pnpm reports:pull --url https://<the game's host> [--since <time>]
 *
 * `--url` (or `HF_REPORTS_URL`) is where the game is served; `--since` is a time
 * in milliseconds or anything `Date` reads (`2026-11-20`), and only reports after
 * it are printed. The token is the Worker's `REPORTS_TOKEN` secret (see
 * CLAUDE.md). Each pull is one request to the reports Durable Object.
 */
import { parseArgs } from "node:util";
import type { Ack, BugReport } from "../../packages/shared/src/index";
import { reportsMarkdown } from "../../packages/server/src/reports";

const { values } = parseArgs({
  options: { url: { type: "string" }, since: { type: "string" } },
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

const url = new URL("/api/reports", base);
url.searchParams.set("since", String(since));
const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (response.status === 404) fail("this host does not serve reports (is REPORTS_TOKEN set on it?)");
if (response.status === 401) fail("that is not this host's reports token");
const answer = (await response.json()) as Ack<BugReport[]>;
if (!answer.ok) fail(answer.error);
process.stdout.write(reportsMarkdown(answer.data));
