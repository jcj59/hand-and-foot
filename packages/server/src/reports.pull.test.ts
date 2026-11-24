/**
 * `pnpm reports:pull` (scripts/reports/pull.ts), run as a developer runs it,
 * against a stand-in for the Worker's `GET /api/reports` that answers in pages:
 * the Markdown it prints, the files it writes, and the replay file it exports,
 * which the engine plays back to the very state the report's table had.
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { heuristicPolicy, replay } from "@hf/engine";
import { EAST_COAST, type BugReport, type ReportsPage } from "@hf/shared";
import { FakeClock } from "./clock";
import { NO_TABLE, reportEntry, reportReplay, tableForReport } from "./reports";
import { Room } from "./room";

const run = promisify(execFile);
const SCRIPT = resolve(__dirname, "../../../scripts/reports/pull.ts");
const TOKEN = "pull-test-token";

function playedRoom(): Room {
  let n = 0;
  const room = new Room("ABC234", EAST_COAST, {
    clock: new FakeClock(1),
    seed: 7,
    newToken: () => `pull-seat-token-${n++}-abcdef`,
  });
  room.join("ana");
  room.join("ben");
  room.start(room.hostSeat);
  for (let i = 0; i < 20; i++) {
    const state = room.gameState!;
    room.submitAction(state.currentSeat, heuristicPolicy(state, state.currentSeat)!);
  }
  return room;
}

const room = playedRoom();
const { record, tokens } = tableForReport(room);
const at = Date.UTC(2026, 10, 21, 9);
const REPORTS: BugReport[] = [
  {
    id: 0,
    ...reportEntry(
      {
        at,
        text: "the pile was wrong",
        context: { summary: { build: "abc1234" }, logs: { frames: [] } },
        room: "ABC234",
      },
      { code: "ABC234", attached: true, record },
      tokens,
    )!,
  },
  ...Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    at: at + i + 1,
    text: `elsewhere ${i}`,
    context: {},
    table: { code: "ZZZ222", attached: false as const, reason: NO_TABLE },
  })),
];

let server: Server;
let url: string;
const asked: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    asked.push(request.url!);
    const query = new URL(request.url!, "http://x").searchParams;
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401).end(JSON.stringify({ ok: false, error: "no" }));
      return;
    }
    // Two a page, so the script has to ask again.
    const since = Number(query.get("since"));
    const after = Number(query.get("after"));
    const left = REPORTS.filter((r) => r.at > since && r.id > after);
    const page: ReportsPage = { reports: left.slice(0, 2), more: left.length > 2 };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, data: page }));
  });
  await new Promise<void>((done) => server.listen(0, done));
  const address = server.address();
  url = `http://localhost:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

async function pull(args: string[], token = TOKEN): Promise<{ stdout: string; stderr: string }> {
  return run(process.execPath, ["--import", "tsx", SCRIPT, "--url", url, ...args], {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, REPORTS_TOKEN: token },
  });
}

describe("pnpm reports:pull", () => {
  it("prints every report as Markdown, asking page by page", async () => {
    asked.length = 0;
    const { stdout } = await pull([]);
    expect(asked.map((u) => new URL(u, "http://x").searchParams.get("after"))).toEqual(["-1", "1"]);
    expect(stdout).toContain("## Report 0, 2026-11-21T09:00:00.000Z\n\n> the pile was wrong");
    expect(stdout).toContain("- **build:** abc1234");
    expect(stdout).toContain("- **Table record:** ABC234, attached: 2 seats, seed 7, 20 moves");
    expect(stdout).toContain("<details><summary>table.actions");
    expect(stdout).toContain(`- **Table record:** ZZZ222, not attached: ${NO_TABLE}`);
    expect(stdout).toContain("## Report 3,");
    for (const token of tokens) expect(stdout).not.toContain(token);
  });

  it("only reports after --since", async () => {
    const { stdout } = await pull(["--since", String(at + 1)]);
    expect(stdout).not.toContain("## Report 0,");
    expect(stdout).not.toContain("## Report 1,");
    expect(stdout).toContain("## Report 2,");
  });

  it("writes each report as files, with a replay file for one whose table came with it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-pull-"));
    try {
      const { stdout } = await pull(["--out", dir]);
      expect(readdirSync(dir).sort()).toEqual([
        "report-0.json",
        "report-0.md",
        "report-0.replay.json",
        "report-1.json",
        "report-1.md",
        "report-2.json",
        "report-2.md",
        "report-3.json",
        "report-3.md",
      ]);
      expect(stdout).toContain("report-0.md (+ replay): the pile was wrong");
      expect(JSON.parse(readFileSync(join(dir, "report-0.json"), "utf8"))).toEqual(REPORTS[0]);
      expect(readFileSync(join(dir, "report-0.md"), "utf8")).toContain("> the pile was wrong");
      expect(JSON.parse(readFileSync(join(dir, "report-0.replay.json"), "utf8"))).toEqual(
        reportReplay(REPORTS[0]!),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exports one report's game as a replay the engine plays to the table's state", async () => {
    const { stdout } = await pull(["--replay", "0"]);
    const log = JSON.parse(stdout) as ReturnType<typeof reportReplay> & {};
    expect(log.setup).toEqual({ seed: 7, playerCount: 2, firstSeat: record.firstSeat });
    expect(log.names).toEqual(["ana", "ben"]);
    const setup = log.setup as { seed: number; playerCount: number; firstSeat: number };
    expect(replay(setup.seed, setup.playerCount, log.config, log.actions, setup.firstSeat)).toEqual(
      room.gameState,
    );
  });

  it("says why a report has no replay, and when the token is wrong", async () => {
    await expect(pull(["--replay", "2"])).rejects.toMatchObject({
      stderr: `report 2's table record is missing: ${NO_TABLE}\n`,
    });
    await expect(pull(["--replay", "9"])).rejects.toMatchObject({
      stderr: "no report 9 is kept\n",
    });
    await expect(pull([], "wrong")).rejects.toMatchObject({
      stderr: "that is not this host's reports token\n",
    });
  });
});
