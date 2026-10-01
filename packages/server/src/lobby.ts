/**
 * Opening a table, sitting down at one, and finding the next game's table — the
 * requests that come before a player holds a table's socket, or that cross tables.
 *
 * A seat taken here is marked disconnected until a socket presents its token,
 * because until then no connection speaks for it: the player is expected on the
 * table's socket at once, and until they arrive nothing is holding the seat.
 */
import type { Ack, RoomOptions, SeatCredentials } from "@hf/shared";
import { configFor, type RoomManager } from "./manager";
import type { Room, RoomPlayer, RoomResult } from "./room";

function seatAt(room: Room, player: RoomPlayer): SeatCredentials {
  room.setConnected(player.seat, false);
  return { roomId: room.id, seat: player.seat, token: player.token };
}

/** Open a table with the creator's choice of rules and seat them at it. */
export function openTable(
  manager: RoomManager,
  name: unknown,
  options: RoomOptions | undefined,
  userId?: string | null,
): Ack<SeatCredentials> {
  const room = manager.create(configFor(options));
  const joined = room.join(String(name ?? ""), userId);
  /* v8 ignore next -- a room created one statement ago cannot be full or started */
  if (!joined.ok) return { ok: false, error: joined.error };
  return { ok: true, data: seatAt(room, joined.value) };
}

/** Sit down at the table with this code. */
export function sitAt(
  manager: RoomManager,
  roomId: string,
  name: unknown,
  userId?: string | null,
): Ack<SeatCredentials> {
  const joined = manager.join(roomId, String(name ?? ""), userId);
  if (!joined.ok) return { ok: false, error: joined.error };
  const player = joined.value.room.seatOf(joined.value.token)!;
  return { ok: true, data: seatAt(joined.value.room, player) };
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
  // The same person at the next game: they carry their identity with them.
  const joined = next.join(player.name, player.userId);
  if (!joined.ok) return { ok: false, error: joined.error };
  return { ok: true, value: seatAt(next, joined.value) };
}
