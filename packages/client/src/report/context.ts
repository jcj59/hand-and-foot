/**
 * What a bug report carries besides the player's own words: everything the page
 * knows that could help a developer recreate the bug, gathered automatically.
 *
 * At a table that is the whole update this seat was sent (its view, hand, foot
 * and melds with every card id, the legal hints, the clock), the table's info,
 * what the player has staged and not played, every move the seat was sent (a
 * draw's card included), and the move lines. Everywhere: the device and page
 * (viewport, layout, motion and color preferences, language, time zone,
 * connection, sound, timings), the profile, the socket's recent frames, console
 * output, errors and notices, the session store, and every `hf.*` key in the
 * browser's storage. The server attaches the table's own record beside it.
 *
 * Reports are read only by whoever fixes bugs, with a secret token, so a card
 * in one is fine; a secret is not. `reportBody` clears every seat token,
 * identity secret and password out of the whole context (`scrubSecrets`), by key
 * and by value, and cuts it to `MAX_REPORT_BODY_BYTES`, the largest sections
 * first, saying what it cut.
 */
import {
  fitToBytes,
  jsonBytes,
  MAX_REPORT_BODY_BYTES,
  scrubSecrets,
  SPECTATOR_SEAT,
  type LastMove,
  type ReportBody,
  type ViewUpdate,
} from "@hf/shared";
import { keepLast, type ClientError } from "./errors";
import type { ConsoleRecord, FrameRecord, NoticeRecord } from "./recorder";

/** How many of the table's latest moves a report carries. */
export const MOVE_RECORDS_KEPT = 200;

/**
 * The kept moves with `move` added, each once (every view repeats the latest
 * move), keeping the newest `MOVE_RECORDS_KEPT`.
 */
export function withRecord(list: readonly LastMove[], move: LastMove): LastMove[] {
  if (list.some((kept) => kept.seq === move.seq)) return [...list];
  return keepLast(list, move, MOVE_RECORDS_KEPT);
}

/** What the table hands the report sheet as it opens. */
export interface TableReport {
  readonly update: ViewUpdate;
  /** The lines the side panel shows ("Kate took the pile (7 cards)"), oldest first. */
  readonly moveLines: readonly string[];
  /** The last moves this seat was sent, oldest first. */
  readonly lastMoves: readonly LastMove[];
  /** Whether a round's result is up. */
  readonly roundOver: boolean;
  /** The table's own screen state: what is staged, chosen, folded, in what order. */
  readonly screen: Readonly<Record<string, unknown>>;
}

/** What the page knows about itself and the device when the report is written. */
export interface PageFacts {
  readonly build: string;
  readonly at: number;
  /** How far the server's clock is ahead of this one, in milliseconds, once known. */
  readonly serverOffsetMs: number | null;
  readonly route: {
    readonly path: string;
    readonly search: string;
    readonly hash: string;
    /** The router's history entry. */
    readonly state: unknown;
  };
  readonly device: Readonly<Record<string, unknown>>;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly phone: boolean;
  readonly userAgent: string;
  /** This browser's identity, when it has one. */
  readonly userId: string | null;
  /** The username it is signed in under, when it is. */
  readonly username: string | null;
  readonly name: string;
  readonly avatar: unknown;
  readonly errors: readonly ClientError[];
  readonly frames: readonly FrameRecord[];
  readonly console: readonly ConsoleRecord[];
  readonly notices: readonly NoticeRecord[];
  /** The session store, functions left out. */
  readonly session: Readonly<Record<string, unknown>>;
  /** Every `hf.*` key, its value read as JSON where it is JSON. */
  readonly storage: {
    readonly local: Readonly<Record<string, unknown>>;
    readonly session: Readonly<Record<string, unknown>>;
  };
  /** Secrets known to the page (identity secret, seat tokens), searched for everywhere. */
  readonly secrets: readonly string[];
}

/** The table's part of a report. */
export interface TableDetails {
  readonly room: ViewUpdate["room"];
  readonly update: ViewUpdate;
  /** The player's own cards, with their ids, as the view has them; absent when watching. */
  readonly own?: {
    readonly hand: ViewUpdate["view"]["hand"];
    readonly footCount: number;
    readonly inFoot: boolean;
    readonly isDown: boolean;
    readonly melds: ViewUpdate["view"]["melds"];
    readonly pickedUp: ViewUpdate["view"]["pickedUp"];
  };
  readonly hints: ViewUpdate["hints"];
  readonly screen: Readonly<Record<string, unknown>>;
  readonly roundOver: boolean;
  readonly moveLines: readonly string[];
  readonly lastMoves: readonly LastMove[];
}

/** The short facts a developer reads first; also the top of the pulled Markdown. */
export interface ReportSummary {
  readonly build: string;
  readonly time: string;
  readonly path: string;
  readonly layout: "phone" | "computer";
  readonly viewport: string;
  readonly browser: string;
  readonly user?: string;
  readonly room?: string;
  readonly seat?: number | "watching";
  readonly round?: string;
  readonly phase?: string;
  readonly seatToPlay?: number;
}

/** Everything a report carries besides the player's words. */
export interface ReportContext {
  readonly summary: ReportSummary;
  readonly page: Readonly<Record<string, unknown>>;
  readonly user: Readonly<Record<string, unknown>>;
  readonly table?: TableDetails;
  readonly logs: {
    readonly frames: readonly FrameRecord[];
    readonly console: readonly ConsoleRecord[];
    readonly errors: readonly ClientError[];
    readonly notices: readonly NoticeRecord[];
  };
  readonly session: Readonly<Record<string, unknown>>;
  readonly storage: PageFacts["storage"];
}

/** The table's part of a report, from what this seat was sent and its screen. */
export function tableDetails(table: TableReport): TableDetails {
  const { view, room, hints } = table.update;
  const watching = view.seat === SPECTATOR_SEAT;
  return {
    room,
    update: table.update,
    ...(watching
      ? {}
      : {
          own: {
            hand: view.hand,
            footCount: view.footCount,
            inFoot: view.inFoot,
            isDown: view.isDown,
            melds: view.melds,
            pickedUp: view.pickedUp,
          },
        }),
    hints,
    screen: table.screen,
    roundOver: table.roundOver,
    moveLines: [...table.moveLines],
    lastMoves: [...table.lastMoves],
  };
}

/** The whole context: the page, the player, the table when at one, and the logs. */
export function reportContext(page: PageFacts, table: TableReport | null): ReportContext {
  const update = table?.update;
  const watching = update?.view.seat === SPECTATOR_SEAT;
  const summary: ReportSummary = {
    build: page.build,
    time: new Date(page.at).toISOString(),
    path: page.route.path,
    layout: page.phone ? "phone" : "computer",
    viewport: `${page.width}x${page.height} @${page.pixelRatio}x`,
    browser: page.userAgent,
    ...(page.username || page.userId
      ? { user: [page.username && `@${page.username}`, page.userId].filter(Boolean).join(" ") }
      : {}),
    ...(update
      ? {
          room: update.room.roomId,
          seat: watching ? ("watching" as const) : update.view.seat,
          round: `${update.view.roundNumber} of ${update.room.config.rounds}`,
          phase: table.roundOver ? "round over" : update.view.phase,
          seatToPlay: update.view.currentSeat,
        }
      : {}),
  };
  // The session's update is the table's, already in `table`.
  const session = table ? { ...page.session, update: "the same as table.update" } : page.session;
  return {
    summary,
    page: {
      build: page.build,
      at: page.at,
      serverOffsetMs: page.serverOffsetMs,
      route: page.route,
      viewport: { width: page.width, height: page.height, pixelRatio: page.pixelRatio },
      layout: summary.layout,
      userAgent: page.userAgent,
      ...page.device,
    },
    user: {
      userId: page.userId,
      username: page.username,
      name: page.name,
      avatar: page.avatar,
    },
    ...(table ? { table: tableDetails(table) } : {}),
    logs: {
      frames: page.frames,
      console: page.console,
      errors: page.errors,
      notices: page.notices,
    },
    session,
    storage: page.storage,
  };
}

/** The widest arrival time the server stamps a report with, so the measure is never short. */
const WIDEST_AT = 9_999_999_999_999;

/**
 * The report as sent: the text trimmed, the table named for the server to attach
 * its record, the context cleared of every secret (`secrets` searched for by
 * value too) and cut until the whole report fits `MAX_REPORT_BODY_BYTES`: the
 * largest log or section first, the table's update and the summary last. What
 * was cut is listed in `context.truncated`. A report that cannot fit even then
 * (very long text) goes as it is, for the server to refuse with its reason.
 */
export function reportBody(
  text: string,
  context: ReportContext,
  secrets: readonly string[] = [],
): ReportBody {
  const trimmed = text.trim();
  const clean = scrubSecrets(context, secrets) as unknown as Record<string, unknown>;
  const room = context.table?.room.roomId;
  const around = jsonBytes({ at: WIDEST_AT, text: trimmed, context: {} }) - 2;
  const fitted = fitToBytes(clean, MAX_REPORT_BODY_BYTES - around, {
    sections: [
      [],
      ["page"],
      ["user"],
      ["table"],
      ["logs"],
      ["session"],
      ["storage"],
      ["storage", "local"],
      ["storage", "session"],
    ],
    last: [["table", "update"], ["summary"]],
  });
  return { text: trimmed, ...(room ? { room } : {}), context: fitted.value };
}
