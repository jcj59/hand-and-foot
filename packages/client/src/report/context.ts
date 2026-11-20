/**
 * What a bug report carries besides the player's own words: where they were,
 * what the table was doing, and what went wrong in the page.
 *
 * Built from an allowlist, field by field, never by copying a view whole: a
 * report is read by whoever fixes the bug, so it must never carry a card the
 * player could not show them. Of the player's own cards it carries only how
 * many there are; of other players' cards, nothing. The moves it carries are
 * the ones this seat was sent, which the server already cut to what this seat
 * may see (another player's drawn card is never in them).
 *
 * The whole report must fit the server's `MAX_REPORT_BYTES`, so `fitReport`
 * drops the oldest errors, then the oldest moves, until it does.
 */
import {
  MAX_REPORT_BYTES,
  SPECTATOR_SEAT,
  type LastMove,
  type ReportBody,
  type ViewUpdate,
} from "@hf/shared";
import { keepLast, type ClientError } from "./errors";

/** How many of the table's latest moves a report carries. */
export const MOVE_RECORDS_KEPT = 20;

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
}

/** What the page knows about itself when the report is written. */
export interface PageFacts {
  readonly build: string;
  readonly at: number;
  readonly path: string;
  readonly userAgent: string;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly phone: boolean;
  /** This browser's identity, when it has one. */
  readonly userId: string | null;
  /** The username it is signed in under, when it is. */
  readonly username: string | null;
  readonly errors: readonly ClientError[];
}

/** The table's part of a report. */
export interface TableDetails {
  readonly room: string;
  /** The player's seat, or "watching". */
  readonly seat: number | "watching";
  readonly round: number;
  readonly rounds: number;
  readonly phase: string;
  readonly seatToPlay: number;
  readonly roundOver: boolean;
  readonly paused: boolean;
  readonly players: number;
  /** How many cards the player holds, and where; never which. Absent when watching. */
  readonly yourCards?: {
    readonly hand: number;
    readonly foot: number;
    readonly inFoot: boolean;
    readonly down: boolean;
    readonly melds: number;
    readonly owedToPile: number;
  };
  readonly stock: number;
  readonly pile: number;
  readonly moveLines: readonly string[];
  readonly lastMoves: readonly LastMove[];
}

/** Everything a report carries besides the player's words. */
export interface ReportContext {
  readonly build: string;
  readonly time: string;
  readonly path: string;
  readonly userAgent: string;
  readonly viewport: string;
  readonly layout: "phone" | "computer";
  readonly userId?: string;
  readonly username?: string;
  readonly table?: TableDetails;
  readonly errors: readonly ClientError[];
}

/** One move as the report carries it: the fields of `LastMove`, copied one by one. */
function moveRecord(move: LastMove): LastMove {
  return {
    seq: move.seq,
    seat: move.seat,
    kind: move.kind,
    ...(move.card
      ? { card: { id: move.card.id, rank: move.card.rank, suit: move.card.suit } }
      : {}),
    ...(move.count !== undefined ? { count: move.count } : {}),
    ...(move.marva ? { marva: true as const } : {}),
  };
}

/** The table's part of a report, from what this seat was sent. */
export function tableDetails(table: TableReport): TableDetails {
  const { view, room } = table.update;
  const watching = view.seat === SPECTATOR_SEAT;
  return {
    room: room.roomId,
    seat: watching ? "watching" : view.seat,
    round: view.roundNumber,
    rounds: room.config.rounds,
    phase: view.phase,
    seatToPlay: view.currentSeat,
    roundOver: table.roundOver,
    paused: table.update.clock.paused,
    players: room.players.length,
    ...(watching
      ? {}
      : {
          yourCards: {
            hand: view.hand.length,
            foot: view.footCount,
            inFoot: view.inFoot,
            down: view.isDown,
            melds: view.melds.length,
            owedToPile: view.pickedUp.length,
          },
        }),
    stock: view.stockCount,
    pile: view.discard.length,
    moveLines: [...table.moveLines],
    lastMoves: table.lastMoves.slice(-MOVE_RECORDS_KEPT).map(moveRecord),
  };
}

/** The whole context: the page, the player, the table unless left out, and the errors. */
export function reportContext(page: PageFacts, table: TableReport | null): ReportContext {
  return {
    build: page.build,
    time: new Date(page.at).toISOString(),
    path: page.path,
    userAgent: page.userAgent,
    viewport: `${page.width}x${page.height} @${page.pixelRatio}x`,
    layout: page.phone ? "phone" : "computer",
    ...(page.userId ? { userId: page.userId } : {}),
    ...(page.username ? { username: page.username } : {}),
    ...(table ? { table: tableDetails(table) } : {}),
    errors: [...page.errors],
  };
}

/** Bytes of a value as UTF-8 JSON, which is what the server's cap is measured in. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** The widest arrival time the server stamps a report with, so the measure is never short. */
const WIDEST_AT = 9_999_999_999_999;

/**
 * The context made one step smaller, or null when there is nothing left to
 * drop: the oldest error first, then the oldest move record, then the oldest
 * move line. What a person needs to place the report (build, page, table,
 * counts) stays.
 */
function smaller(context: ReportContext): ReportContext | null {
  if (context.errors.length > 0) return { ...context, errors: context.errors.slice(1) };
  const table = context.table;
  if (table && table.lastMoves.length > 0) {
    return { ...context, table: { ...table, lastMoves: table.lastMoves.slice(1) } };
  }
  if (table && table.moveLines.length > 0) {
    return { ...context, table: { ...table, moveLines: table.moveLines.slice(1) } };
  }
  return null;
}

/**
 * The report as sent: the text trimmed, and the context cut down until the
 * whole report fits `MAX_REPORT_BYTES`. A report that cannot fit even then
 * (very long text) goes as it is, for the server to refuse with its reason.
 */
export function fitReport(text: string, context: ReportContext): FittedReport {
  const trimmed = text.trim();
  let fitted = context;
  while (jsonBytes({ at: WIDEST_AT, text: trimmed, context: fitted }) > MAX_REPORT_BYTES) {
    const next = smaller(fitted);
    if (!next) break;
    fitted = next;
  }
  return { text: trimmed, context: fitted };
}

/** A report ready to send: a `ReportBody` whose context is known to be this one. */
export interface FittedReport {
  readonly text: string;
  readonly context: ReportContext;
}

/** The report as the server's contract types it. */
export function reportBody(report: FittedReport): ReportBody {
  return { text: report.text, context: report.context as unknown as Record<string, unknown> };
}

/** One line of the list the sheet shows of what a report carries. */
export interface AttachmentRow {
  readonly label: string;
  readonly value: string;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The list the sheet shows, in words, of everything in `context`. */
export function attachmentRows(context: ReportContext): AttachmentRow[] {
  const rows: AttachmentRow[] = [
    { label: "Version", value: context.build },
    { label: "Time", value: context.time },
    { label: "Page", value: context.path },
    { label: "Browser", value: context.userAgent },
    { label: "Screen", value: `${context.viewport}, ${context.layout} layout` },
  ];
  if (context.username || context.userId) {
    rows.push({
      label: "Profile",
      value: [context.username && `@${context.username}`, context.userId && `id ${context.userId}`]
        .filter(Boolean)
        .join(", "),
    });
  }
  const table = context.table;
  if (table) {
    rows.push({
      label: "Table",
      value: [
        table.room,
        table.seat === "watching" ? "watching" : `seat ${table.seat}`,
        `round ${table.round} of ${table.rounds}`,
        table.roundOver ? "round over" : `${table.phase} phase`,
        ...(table.paused ? ["paused"] : []),
      ].join(", "),
    });
    if (table.yourCards) {
      const cards = table.yourCards;
      rows.push({
        label: "Your cards",
        value: `how many only: ${plural(cards.hand, "card")} in hand, ${cards.foot} in the foot, ${plural(cards.melds, "meld")}`,
      });
    }
    rows.push({ label: "Piles", value: `stock ${table.stock}, pile ${table.pile}` });
    rows.push({
      label: "Moves",
      value: `the last ${plural(table.lastMoves.length, "move")}, as you were shown them`,
    });
  }
  rows.push({
    label: "Errors",
    value:
      context.errors.length === 0
        ? "none on this page"
        : `the last ${plural(context.errors.length, "error")} on this page`,
  });
  return rows;
}
