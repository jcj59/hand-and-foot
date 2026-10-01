/**
 * The games this device has saved for later, for the home screen to offer back.
 *
 * A saved game is meant to outlive everything else about the visit: the tab, the
 * browser, and the other tables played in the meantime. The one seat kept in
 * `credentials.ts` cannot carry that — the next table sat at replaces it — so each
 * saved game keeps its own seat here, in `localStorage`, with what the list needs
 * to say which game it is: who was playing, which round, and until when it is
 * kept.
 *
 * Kept from what the server says, never decided here: a table is remembered while
 * its `RoomInfo` says it is saved, and forgotten once it says it was picked back up
 * or the table is gone. Read back field by field, like the seat, because it is
 * editable and outlives versions of this app.
 */
import type { RoomInfo, SeatCredentials } from "@hf/shared";
import type { CredentialStore } from "./credentials";

export const SAVED_GAMES_KEY = "hf.savedGames";

export interface SavedGame extends SeatCredentials {
  /** Server time the table is kept until. */
  readonly savedUntil: number;
  /** Everyone at the table, in seat order. */
  readonly names: readonly string[];
  /** The round the game was saved in. */
  readonly round: number;
}

/** `localStorage` if this browser lets the page have it; a saved game is meant to last. */
export function savedGamesStore(): CredentialStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.roomId === "string" &&
    v.roomId !== "" &&
    typeof v.token === "string" &&
    v.token !== "" &&
    Number.isInteger(v.seat) &&
    (v.seat as number) >= 0 &&
    Number.isFinite(v.savedUntil) &&
    Array.isArray(v.names) &&
    v.names.every((n) => typeof n === "string") &&
    Number.isInteger(v.round)
  );
}

/** Every saved game on this device, soonest to close first. Expiry is the reader's call. */
export function loadSavedGames(
  store: CredentialStore | null = savedGamesStore(),
): readonly SavedGame[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(store?.getItem(SAVED_GAMES_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isSavedGame)
    .map(({ roomId, seat, token, savedUntil, names, round }) => ({
      roomId,
      seat,
      token,
      savedUntil,
      names: [...names],
      round,
    }))
    .sort((a, b) => a.savedUntil - b.savedUntil);
}

function write(games: readonly SavedGame[], store: CredentialStore | null): void {
  try {
    if (games.length === 0) store?.removeItem(SAVED_GAMES_KEY);
    else store?.setItem(SAVED_GAMES_KEY, JSON.stringify(games));
  } catch {
    // A full or blocked store loses the list, not the game: the table's link still works.
  }
}

/** Remember a saved game, replacing what was known about the same table. */
export function rememberSavedGame(
  game: SavedGame,
  store: CredentialStore | null = savedGamesStore(),
): void {
  const others = loadSavedGames(store).filter((g) => g.roomId !== game.roomId);
  write([...others, game], store);
}

export function forgetSavedGame(
  roomId: string,
  store: CredentialStore | null = savedGamesStore(),
): void {
  const games = loadSavedGames(store);
  if (games.some((g) => g.roomId === roomId)) {
    write(
      games.filter((g) => g.roomId !== roomId),
      store,
    );
  }
}

/**
 * Bring the list up to date with what the server just said about the table this
 * tab is seated at: remember it while it is saved, forget it once it is being
 * played again. A lobby (not started) says nothing either way.
 */
export function noteRoom(
  room: RoomInfo,
  credentials: SeatCredentials | null,
  round: number | null,
  store: CredentialStore | null = savedGamesStore(),
): void {
  if (!room.started || credentials?.roomId !== room.roomId) return;
  if (room.savedUntil == null) return forgetSavedGame(room.roomId, store);
  const known = loadSavedGames(store).find((g) => g.roomId === room.roomId);
  rememberSavedGame(
    {
      roomId: credentials.roomId,
      seat: credentials.seat,
      token: credentials.token,
      savedUntil: room.savedUntil,
      names: room.players.map((p) => p.name),
      round: round ?? known?.round ?? 1,
    },
    store,
  );
}
