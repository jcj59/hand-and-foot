import { EAST_COAST, WEST_COAST, type RoomOptions, type RulesConfig } from "@hf/shared";
import { defaultConfig } from "@hf/engine";
import { type Clock, systemClock } from "./clock";
import { Room, type RoomResult } from "./room";

/**
 * Turn the creator's choices into the rules the table will actually play by.
 *
 * The option set is deliberately small and closed so that a value outside it
 * can be coerced to a safe default without a validator — TypeScript only
 * enforces the `RoomOptions` union for typed callers, and `options` here
 * arrives from an untyped socket payload, so every field is normalized
 * rather than trusted as-is. `mode` decides pausing rather than leaving it as
 * a second switch, because a competitive table is precisely one where the
 * clock cannot be stopped, and letting the two be set independently would
 * only create states nobody wants.
 */
export function configFor(options: RoomOptions = {}): RulesConfig {
  const preset = options.preset === "west-coast" ? WEST_COAST : EAST_COAST;
  if (options.mode === undefined) return preset;
  const mode = options.mode === "competitive" ? "competitive" : "family";
  return { ...preset, mode, pauseEnabled: mode === "family" };
}

/**
 * Room codes are typed by a human off a shared link or read aloud across a
 * table, so the alphabet leaves out the characters people confuse: no O/0, no
 * I/1/L. Six characters from a 30-symbol alphabet is ~2.9 billion codes, which
 * is ample for a game whose rooms are short-lived.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

export interface ManagerOptions {
  readonly clock?: Clock;
  /**
   * Injected rather than reached for so tests are deterministic. In production
   * these are random; the game seed in particular must stay on the server, since
   * it determines the deck order.
   */
  readonly random?: () => number;
}

function randomString(alphabet: string, length: number, random: () => number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return out;
}

/** Owns the set of live rooms and hands out room codes and seat tokens. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly clock: Clock;
  private readonly random: () => number;

  constructor(options: ManagerOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
  }

  get size(): number {
    return this.rooms.size;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  create(config: RulesConfig = defaultConfig): Room {
    let id = this.newCode();
    // Collisions are vanishingly unlikely but not impossible, and reusing a live
    // room's code would drop a stranger into someone else's game.
    while (this.rooms.has(id)) id = this.newCode();

    const room = new Room(id, config, {
      clock: this.clock,
      seed: Math.floor(this.random() * 2 ** 31),
      newToken: () => randomString(CODE_ALPHABET, 24, this.random),
    });
    this.rooms.set(id, room);
    return room;
  }

  /** Room codes are matched case-insensitively; nobody types a link exactly. */
  join(roomId: string, name: string): RoomResult<{ room: Room; seat: number; token: string }> {
    const room = this.get(roomId);
    if (!room) return { ok: false, error: "no room with that code" };
    const joined = room.join(name);
    if (!joined.ok) return joined;
    return { ok: true, value: { room, seat: joined.value.seat, token: joined.value.token } };
  }

  remove(roomId: string): boolean {
    return this.rooms.delete(roomId.toUpperCase());
  }

  private newCode(): string {
    return randomString(CODE_ALPHABET, CODE_LENGTH, this.random);
  }
}
