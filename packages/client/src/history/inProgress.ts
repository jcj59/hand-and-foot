/**
 * The games History shows above the recent ones: the seat this device still holds
 * at a table, and the games it saved for later. None of them is recorded yet (a
 * match is recorded once its table closes), so they come from this device alone,
 * never from the server: the held seat from `credentials.ts`, the saved games from
 * `savedGames.ts`, and, when this tab is at the held table, who is sitting there.
 * Pure, so what is offered and how it reads are pinned by a test.
 */
import type { MatchListing, RoomInfo, RoomPlayerInfo, SeatCredentials } from "@hf/shared";
import { heldSeat, type SavedGame } from "../savedGames";
import { day, resultOf } from "./describe";
import type { Filters } from "./filters";

/** Someone at an unfinished table, as far as this device knows them. */
export interface Seated extends Pick<RoomPlayerInfo, "name" | "avatar" | "bot" | "botLevel"> {
  readonly you: boolean;
}

export type InProgressGame =
  | {
      /** A seat this tab holds (or an earlier visit kept) at a table still being played. */
      readonly kind: "held";
      readonly roomId: string;
      /** Who sits there, known only while this tab is at that table. */
      readonly players: readonly Seated[] | null;
    }
  | {
      /** A game saved for later, with its own seat to pick it back up with. */
      readonly kind: "saved";
      readonly roomId: string;
      readonly players: readonly Seated[];
      readonly game: SavedGame;
    };

export interface InProgressSources {
  /** The seat this tab holds, or the one kept from an earlier visit. */
  readonly stored: SeatCredentials | null;
  /** What this tab last heard about the table it is at, if any. */
  readonly room: RoomInfo | null;
  /** The saved games still kept (see `liveSavedGames`), soonest to close first. */
  readonly saved: readonly SavedGame[];
  /** The recorded games, to leave out a saved game whose card is already there. */
  readonly recorded: readonly MatchListing[];
}

/**
 * The held seat first, then the saved games, soonest to close first. A seat at a
 * saved game is offered as the saved game (as on Home). A saved game whose match
 * is already recorded as unfinished is left to that card, which offers the same
 * Resume beside its scores.
 */
export function inProgressGames({
  stored,
  room,
  saved,
  recorded,
}: InProgressSources): InProgressGame[] {
  const held = heldSeat(stored, saved);
  const onRecord = new Set(
    recorded.filter((m) => resultOf(m) === "unfinished").map((m) => m.roomId),
  );
  const games: InProgressGame[] = [];
  if (held) {
    const players =
      room?.roomId === held.roomId
        ? room.players
            .filter((p) => !p.departed)
            .map(({ name, avatar, bot, botLevel, seat }) => ({
              name,
              avatar,
              bot,
              botLevel,
              you: seat === held.seat,
            }))
        : null;
    games.push({ kind: "held", roomId: held.roomId, players });
  }
  for (const game of saved) {
    if (onRecord.has(game.roomId)) continue;
    const players = game.names.map((name, seat) => ({ name, you: seat === game.seat }));
    games.push({ kind: "saved", roomId: game.roomId, players, game });
  }
  return games;
}

/**
 * Whether the filters keep a game in progress. It has no place yet, so it counts
 * as unfinished; it is being played now, so every "When" keeps it; and "Played
 * with" keeps it only when everyone chosen is known to be at that table.
 */
export function keepsInProgress(game: InProgressGame, filters: Filters): boolean {
  if (filters.place !== "all" && filters.place !== "unfinished") return false;
  return filters.with.every(
    (name) => game.players?.some((p) => !p.you && !p.bot && p.name === name) ?? false,
  );
}

/** The card's heading. */
export function inProgressTitle(game: InProgressGame): string {
  return game.kind === "held" ? "In progress" : "Saved for later";
}

/** The line under the heading: "Table ABC234 · kept until Nov 26". */
export function inProgressMeta(game: InProgressGame): string {
  return game.kind === "held"
    ? `Table ${game.roomId} · your seat is waiting`
    : `Table ${game.roomId} · kept until ${day(game.game.savedUntil)}`;
}
