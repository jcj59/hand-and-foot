/**
 * Opening a table, sitting down at one, and finding the next game's table — the
 * requests that come before a player holds a table's socket, or that cross tables.
 *
 * A seat taken here is marked disconnected until a socket presents its token,
 * because until then no connection speaks for it: the player is expected on the
 * table's socket at once, and until they arrive nothing is holding the seat.
 */
import { resolveRules, type Ack, type SeatCredentials } from "@hf/shared";
import type { RoomManager } from "./manager";
import type { Room, RoomPlayer, RoomResult, SeatProfile } from "./room";

function seatAt(room: Room, player: RoomPlayer): SeatCredentials {
  room.setConnected(player.seat, false);
  return { roomId: room.id, seat: player.seat, token: player.token };
}

/**
 * Open a table with the creator's choice of rules and seat them at it. `options`
 * is whatever the request carried; rules that do not check out refuse the table,
 * with the reason, before anything is created.
 */
export function openTable(
  manager: RoomManager,
  name: unknown,
  options: unknown,
  profile: SeatProfile = {},
): Ack<SeatCredentials> {
  const rules = resolveRules(options);
  if (!rules.ok) return rules;
  const room = manager.create(rules.data);
  const joined = room.join(String(name ?? ""), profile);
  /* v8 ignore next -- a room created one statement ago cannot be full or started */
  if (!joined.ok) return { ok: false, error: joined.error };
  return { ok: true, data: seatAt(room, joined.value) };
}

/** Sit down at the table with this code. */
export function sitAt(
  manager: RoomManager,
  roomId: string,
  name: unknown,
  profile: SeatProfile = {},
): Ack<SeatCredentials> {
  const joined = manager.join(roomId, String(name ?? ""), profile);
  if (!joined.ok) return { ok: false, error: joined.error };
  const player = joined.value.room.seatOf(joined.value.token)!;
  return { ok: true, data: seatAt(joined.value.room, player) };
}

/**
 * Open the next game for a rematch: the same rules, the players in the same order —
 * computer players too — the same host, dealt at once. Returns each person's seat
 * there by their token at this table.
 */
export function rematchFor(
  manager: RoomManager,
  room: Room,
  players: readonly RoomPlayer[],
): RoomResult<ReadonlyMap<string, SeatCredentials>> {
  const next = manager.create(room.config);
  const seats = new Map<string, SeatCredentials>();
  let host: number | null = null;
  for (const player of players) {
    if (player.bot) {
      next.addBot(next.hostSeat);
      continue;
    }
    const joined = next.join(player.name, { userId: player.userId, avatar: player.avatar });
    /* v8 ignore next -- a fresh table seats as many as the finished one had */
    if (!joined.ok) return { ok: false, error: joined.error };
    seats.set(player.token, seatAt(next, joined.value));
    if (player.seat === room.hostSeat) host = joined.value.seat;
  }
  if (host !== null) next.setHost(next.hostSeat, host);
  next.start(next.hostSeat);
  room.nextRoomId = next.id;
  return { ok: true, value: seats };
}

/**
 * Seat a player from a finished table at the next game's waiting room: the one
 * the first to ask opened, or a new one with the same rules if there is none yet
 * (or it was reaped). A waiting room already dealt is refused, not replaced.
 */
export function nextTableFor(
  manager: RoomManager,
  room: Room,
  player: RoomPlayer,
): RoomResult<SeatCredentials> {
  let next = room.nextRoomId === null ? undefined : manager.get(room.nextRoomId);
  if (next?.started) return { ok: false, error: "the next game has already started without you" };
  if (!next) {
    next = manager.create(room.config);
    room.nextRoomId = next.id;
  }
  // The same person at the next game: they carry their identity and picture with them.
  const joined = next.join(player.name, { userId: player.userId, avatar: player.avatar });
  if (!joined.ok) return { ok: false, error: joined.error };
  return { ok: true, value: seatAt(next, joined.value) };
}
