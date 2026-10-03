/**
 * One table, as a Cloudflare Durable Object: its game, its connections and its
 * storage, addressed by the table's code.
 *
 * Everything a table does is the server's own `Room` and `TableChannel`, the same
 * code the Node server runs; this object only gives them a home. The game lives in
 * the object's storage always, and in memory only while something is happening.
 *
 * That split is what keeps it free. Sockets are accepted through the hibernation
 * API, so a table where nobody is moving — between turns of an untimed game, a
 * paused table, a finished round waiting for Ready — lets the object be put to
 * sleep with its players' sockets still open, and an object asleep is not billed.
 * The next message wakes it: the constructor rebuilds the game from its log, as
 * the Node server does after a deploy, and then seats each still-open socket again
 * from the token it carries, so its player never notices. A running turn clock
 * holds a timer, which keeps the object awake; that is a table actually in play.
 *
 * Cloudflare can also restart an object outright, closing its sockets. Then the
 * rebuilt game has every seat disconnected until its player's client reconnects
 * and reclaims it, exactly as after a Node server restart.
 */
import { DurableObject } from "cloudflare:workers";
import {
  keptFor,
  refusal,
  Room,
  systemClock,
  TableChannel,
  type RoomDeps,
  type RoomPlayer,
  type RoomResult,
  type SeatProfile,
} from "@hf/server/core";
import {
  PING,
  PONG,
  ROOM_CODE_ALPHABET,
  type Ack,
  type ClientFrame,
  type MatchRecord,
  type RulesConfig,
  type SeatCredentials,
} from "@hf/shared";
import { newCode } from "./codes";
import type { Env } from "./env";
import { DurableRoomStore } from "./storage";

/** How long a table nobody is at is kept before it is closed and its code freed. */
export const ABANDONED_TABLE_MS = 30 * 60_000;

/** The answer when a new table's code is already a live table's. */
export const TAKEN = "taken";

/** One seat of a rematch, as the new table is told it. */
interface RematchSeat {
  readonly name: string;
  readonly profile: SeatProfile;
  readonly bot: boolean;
  readonly host: boolean;
}

/** The connection id of a socket opened to a code with no table behind it. */
const NO_TABLE = 0;

/**
 * What a socket carries through the object's sleep: which connection it was, and
 * the seat token it held, if any.
 */
interface Attachment {
  readonly connection: number;
  readonly token: string | null;
}

function attachment(ws: WebSocket): Attachment {
  return ws.deserializeAttachment() as Attachment;
}

function send(ws: WebSocket, text: string): void {
  try {
    ws.send(text);
  } catch {
    // Closing already: the close handler is on its way.
  }
}

/** A request frame, or null for anything that is not one. */
function parse(data: string | ArrayBuffer): ClientFrame | null {
  try {
    const frame = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    return typeof frame?.id === "number" && typeof frame.event === "string" ? frame : null;
  } catch {
    return null;
  }
}

function randomString(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export class TableObject extends DurableObject<Env> {
  private readonly store: DurableRoomStore;
  private channel: TableChannel | null = null;
  private nextTableQueue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The client's keep-alive is answered without waking the object: an idle table
    // costs nothing while its players' sockets stay open.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    this.store = new DurableRoomStore(ctx.storage.kv);
    // A restart, or the first request after the object was evicted: bring the game
    // back from its log. One that will not replay is closed rather than rebuilt
    // wrong, as on the Node server.
    const stored = this.store.current();
    if (!stored) return;
    const restored = Room.restore(stored, this.deps());
    if (!restored.ok) {
      this.store.closeRoom(stored.room.uid, systemClock.now());
      return;
    }
    this.install(restored.value);
    this.rewire();
  }

  // --------------------------------------------------------------------- RPC ---

  /** Open a new table here, under `code`, and seat its creator. */
  async open(
    code: string,
    config: RulesConfig,
    name: string,
    profile: SeatProfile = {},
  ): Promise<Ack<SeatCredentials> | typeof TAKEN> {
    if (this.channel) return TAKEN;
    // Sockets still open from a table closed under this code belong to that one.
    for (const ws of this.ctx.getWebSockets()) {
      ws.serializeAttachment({ connection: NO_TABLE, token: null } satisfies Attachment);
    }
    const room = new Room(code, config, {
      ...this.deps(),
      seed: crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1,
      uid: crypto.randomUUID(),
    });
    this.store.saveRoom(room.record());
    this.install(room);
    return this.sit(name, profile);
  }

  /**
   * Open a new table here, under `code`, as a rematch of another: these players in
   * this order — a person with their identity and picture, or a computer player —
   * the host among them hosting, dealt at once. Each person's seat, in order; null
   * for a computer player.
   */
  async openRematch(
    code: string,
    config: RulesConfig,
    seats: readonly RematchSeat[],
  ): Promise<Ack<(SeatCredentials | null)[]> | typeof TAKEN> {
    if (this.channel) return TAKEN;
    for (const ws of this.ctx.getWebSockets()) {
      ws.serializeAttachment({ connection: NO_TABLE, token: null } satisfies Attachment);
    }
    const room = new Room(code, config, {
      ...this.deps(),
      seed: crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1,
      uid: crypto.randomUUID(),
    });
    this.store.saveRoom(room.record());
    this.install(room);
    const out: (SeatCredentials | null)[] = [];
    let host: number | null = null;
    for (const seat of seats) {
      if (seat.bot) {
        room.addBot(room.hostSeat);
        out.push(null);
        continue;
      }
      const joined = room.join(seat.name, seat.profile);
      /* v8 ignore next -- a fresh table seats as many as the finished one had */
      if (!joined.ok) return { ok: false, error: joined.error };
      room.setConnected(joined.value.seat, false);
      if (seat.host) host = joined.value.seat;
      out.push({ roomId: room.id, seat: joined.value.seat, token: joined.value.token });
    }
    if (host !== null) room.setHost(room.hostSeat, host);
    room.start(room.hostSeat);
    this.scheduleReaping();
    return { ok: true, data: out };
  }

  /** Sit down at this table, as the identity the Worker verified (if any), with their picture. */
  async sit(name: string, profile: SeatProfile = {}): Promise<Ack<SeatCredentials>> {
    const room = this.channel?.room;
    if (!room) return { ok: false, error: "no room with that code" };
    const joined = room.join(name, profile);
    if (!joined.ok) return { ok: false, error: joined.error };
    // No socket speaks for the seat until the player's client presents the token.
    room.setConnected(joined.value.seat, false);
    this.scheduleReaping();
    return {
      ok: true,
      data: { roomId: room.id, seat: joined.value.seat, token: joined.value.token },
    };
  }

  /** Sit down at this table as the next game of another, which is refused once dealt. */
  async sitNext(name: string, profile: SeatProfile = {}): Promise<Ack<SeatCredentials>> {
    if (this.channel?.room.started) {
      return { ok: false, error: "the next game has already started without you" };
    }
    return this.sit(name, profile);
  }

  // ------------------------------------------------------------------ socket ---

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("expected a websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Accepted through the object rather than on the socket, so that the object can
    // sleep while the socket stays open, and be woken by its next message.
    this.ctx.acceptWebSocket(server);
    // A code with no table behind it still answers — see `webSocketMessage` — so a
    // client is told the room is gone rather than left to time out.
    const connection = this.channel ? this.wire(server) : NO_TABLE;
    server.serializeAttachment({ connection, token: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const frame = parse(data);
    if (!frame) return;
    const { connection } = attachment(ws);
    if (!this.channel || connection === NO_TABLE) {
      send(ws, JSON.stringify({ ack: frame.id, result: refusal(frame.event) }));
      return;
    }
    await this.channel.handle(connection, frame);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const { connection } = attachment(ws);
    if (!this.channel || connection === NO_TABLE) return;
    this.channel.disconnect(connection);
    this.scheduleReaping();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * Hand a socket to the channel — a new one, or, given its old connection id, one
   * that stayed open while the object slept. Whatever seat the channel says the
   * socket holds is written onto the socket itself, which is the only thing that
   * outlives the object's memory.
   */
  private wire(ws: WebSocket, previous?: number): number {
    let connection = NO_TABLE;
    connection = this.channel!.connect(
      {
        send: (frame) => send(ws, JSON.stringify(frame)),
        seated: (token) => ws.serializeAttachment({ connection, token } satisfies Attachment),
      },
      previous,
    );
    return connection;
  }

  /** After a wake: seat every socket that was still open again, as it was. */
  private rewire(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const { connection, token } = attachment(ws);
      if (connection === NO_TABLE) continue;
      this.wire(ws, connection);
      // A token that no longer holds a seat here is simply forgotten; the client's
      // next request is refused as not seated and it reclaims, as after a drop.
      if (token !== null && !this.channel!.adoptSeat(connection, token)) {
        ws.serializeAttachment({ connection, token: null } satisfies Attachment);
      }
    }
  }

  // ----------------------------------------------------------------- reaping ---

  /**
   * A table where everyone has gone is closed after a while, freeing its code, as
   * the Node server's reaper does. The alarm is only a reminder to look: whether
   * the table is still empty is decided when it fires.
   */
  override async alarm(): Promise<void> {
    this.alarmAt = null;
    const channel = this.channel;
    const closing = channel?.room.closing(ABANDONED_TABLE_MS) ?? null;
    if (!channel || closing === null) return;
    if (systemClock.now() < closing.at) {
      this.scheduleReaping();
      return;
    }
    // A match closing before its last round is kept as far as it got.
    channel.room.recordUnfinished();
    this.store.closeRoom(channel.room.uid, systemClock.now());
    channel.room.dispose();
    // Anyone still looking at it is told why, rather than finding out on their
    // next click.
    channel.close(closing.reason);
    this.channel = null;
  }

  /** The alarm last set, so an unchanged closing time is not written again. */
  private alarmAt: number | null = null;

  /**
   * Set the alarm for when the table would close — abandoned, or paused too long;
   * see `Room.closing`. Called whenever anything about the table changes. A time
   * that moved later leaves an early alarm behind, which only finds the table
   * still wanted and sets the next one.
   */
  private scheduleReaping(): void {
    const at = this.channel?.room.closing(ABANDONED_TABLE_MS)?.at ?? null;
    if (at === null || at === this.alarmAt) return;
    this.alarmAt = at;
    void this.ctx.storage.setAlarm(at);
  }

  // ---------------------------------------------------------------- plumbing ---

  private install(room: Room): void {
    this.channel = new TableChannel(room, {
      nextTable: (from, player) => this.nextTable(from, player),
      rematch: (from, players) => {
        const turn = this.nextTableQueue.then(() => this.rematchAt(from, players));
        this.nextTableQueue = turn.catch(() => undefined);
        return turn;
      },
      changed: () => this.scheduleReaping(),
    });
  }

  /**
   * Seat a player from this finished table at the next game's waiting room: the
   * one the first to ask opened, or a new one with the same rules. Requests run
   * one at a time: the calls to other objects release the input gate, so a second
   * request arriving meanwhile would otherwise open a table of its own.
   */
  private nextTable(room: Room, player: RoomPlayer): Promise<RoomResult<SeatCredentials>> {
    const turn = this.nextTableQueue.then(() => this.seatAtNextTable(room, player));
    this.nextTableQueue = turn.catch(() => undefined);
    return turn;
  }

  private async seatAtNextTable(
    room: Room,
    player: RoomPlayer,
  ): Promise<RoomResult<SeatCredentials>> {
    // The same person at the next game: their identity and picture go with them.
    const carried: SeatProfile = { userId: player.userId ?? null, avatar: player.avatar ?? null };
    const answer = async (): Promise<Ack<SeatCredentials>> => {
      if (room.nextRoomId !== null) {
        const seated = await this.env.TABLES.getByName(room.nextRoomId).sitNext(
          player.name,
          carried,
        );
        // Reaped since: open a fresh one below instead.
        if (seated.ok || seated.error !== "no room with that code") return seated;
      }
      for (;;) {
        const code = newCode();
        const opened = await this.env.TABLES.getByName(code).open(
          code,
          room.config,
          player.name,
          carried,
        );
        if (opened === TAKEN) continue;
        if (opened.ok) room.nextRoomId = code;
        return opened;
      }
    };
    const seated = await answer();
    return seated.ok ? { ok: true, value: seated.data } : { ok: false, error: seated.error };
  }

  /** Open the rematch's table under a fresh code, and say where each person sits there. */
  private async rematchAt(
    room: Room,
    players: readonly RoomPlayer[],
  ): Promise<RoomResult<ReadonlyMap<string, SeatCredentials>>> {
    const seats: RematchSeat[] = players.map((p) => ({
      name: p.name,
      profile: { userId: p.userId ?? null, avatar: p.avatar ?? null },
      bot: p.bot === true,
      host: p.seat === room.hostSeat,
    }));
    for (;;) {
      const code = newCode();
      const opened = await this.env.TABLES.getByName(code).openRematch(code, room.config, seats);
      if (opened === TAKEN) continue;
      if (!opened.ok) return { ok: false, error: opened.error };
      room.nextRoomId = code;
      const byToken = new Map<string, SeatCredentials>();
      players.forEach((p, i) => {
        const seat = opened.data[i];
        if (seat) byToken.set(p.token, seat);
      });
      return { ok: true, value: byToken };
    }
  }

  private deps(): Omit<RoomDeps, "seed"> {
    return {
      clock: systemClock,
      newToken: () => randomString(ROOM_CODE_ALPHABET, 24),
      store: this.store,
      recordMatch: (record) => this.keepMatch(record),
    };
  }

  /**
   * Send a match to each of its players' identity objects. Not awaited by the
   * game, but kept running past the request that ended it; a copy that fails to
   * arrive costs that player one entry in their history, never the table its game.
   */
  private keepMatch(record: MatchRecord): void {
    for (const userId of keptFor(record)) {
      this.ctx.waitUntil(
        this.env.USERS.getByName(userId)
          .recordMatch(userId, record)
          .catch((error: unknown) => console.error(`could not keep match ${record.id}:`, error)),
      );
    }
  }
}
