/**
 * One table's connections: who is seated on which socket, what each request does,
 * and who hears about it.
 *
 * It knows nothing about the transport. The Node server drives it from `ws`
 * sockets and the Cloudflare Worker from a Durable Object's, and both get the same
 * rules, because the rules are here:
 *
 * - The seat a connection may act as comes from the table's own record of which
 *   connection presented which token, never from a payload — otherwise any client
 *   could play as any seat, and the authoritative server would be authoritative
 *   over nothing.
 * - Every view goes out per connection through `viewFor(seat)`. A single payload
 *   built for the table is exactly how hidden cards leak.
 * - Only the connection that currently holds a seat speaks for it. A player who
 *   reconnects is on a new connection before the old one is noticed gone, and the
 *   old one's late departure must not mark them absent or give their seat away.
 */
import type { Ack, ClientFrame, CloseReason, SeatCredentials, ServerFrame } from "@hf/shared";
import { isDraft, type Room, type RoomPlayer, type RoomResult } from "./room";

/** One connection to the table, as the transport sees it. */
export interface Peer {
  send(frame: ServerFrame): void;
  /**
   * The seat this connection speaks for changed: the token it now holds, or null.
   * A transport whose table can sleep with its sockets still open — a hibernating
   * Durable Object — records it on the socket, so that on waking it can say which
   * connection held which seat through `adoptSeat`.
   */
  seated?(token: string | null): void;
}

export interface TableHooks {
  /**
   * Seat a player from this finished table at the next game's waiting room — the
   * same one for everyone who asks — and return their seat there. Crosses tables,
   * so the transport that knows how to reach other tables provides it.
   */
  nextTable(room: Room, player: RoomPlayer): Promise<RoomResult<SeatCredentials>>;
  /**
   * Open the next game for a rematch with these players, in this order, and deal it:
   * each person's seat there, by their token here. Crosses tables, as `nextTable` does.
   */
  rematch(
    room: Room,
    players: readonly RoomPlayer[],
  ): Promise<RoomResult<ReadonlyMap<string, SeatCredentials>>>;
  /**
   * Something about the table changed — a request handled, or a move the server
   * made itself. For a host that has to act on when the table would close, as a
   * Durable Object setting its alarm does.
   */
  changed?(): void;
}

export const NOT_SEATED = "you are not seated in a room";

/**
 * The answer to anything asked of a table that does not exist: a reclaim is told
 * the room is gone, which sends a client home; anything else, that it holds no seat.
 */
export function refusal(event: string): Ack<never> {
  return { ok: false, error: event === "resumeSeat" ? "no room with that code" : NOT_SEATED };
}

function ackOf<T>(result: RoomResult<T>): Ack<T> {
  return result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error };
}

export class TableChannel {
  private readonly peers = new Map<number, Peer>();
  /** The token each seated connection holds. */
  private readonly sessions = new Map<number, string>();
  /** The one connection that currently speaks for each token. */
  private readonly owners = new Map<string, number>();
  /** Seats on their way to the next game, so a second click waits for the first. */
  private readonly moving = new Map<string, Promise<Ack<SeatCredentials>>>();
  /** A rematch being opened, so a second tap waits for it rather than opening another table. */
  private rematching: Promise<RoomResult<ReadonlyMap<string, SeatCredentials>>> | null = null;
  /**
   * Where each connection was sent. The seat here is let go as the move finishes,
   * so a repeat of the same click arriving after it would otherwise be refused as
   * not seated rather than told the same thing again.
   */
  private readonly sent = new Map<number, Ack<SeatCredentials>>();
  private nextConnection = 1;
  private retired = false;

  constructor(
    readonly room: Room,
    private readonly hooks: TableHooks,
  ) {
    // A move the *server* makes — a timeout, a dropped player's turn — reaches the
    // table without anyone having asked.
    room.onChange = () => {
      this.broadcastViews();
      this.broadcastRoom();
      this.broadcastResult();
      this.hooks.changed?.();
    };
  }

  /**
   * A new connection, holding no seat until it presents a token. A transport
   * bringing back connections that outlived the table's memory passes the id each
   * had before, so later ones are numbered past them.
   */
  connect(peer: Peer, id: number = this.nextConnection): number {
    this.nextConnection = Math.max(this.nextConnection, id + 1);
    this.peers.set(id, peer);
    return id;
  }

  /**
   * Seat a connection that held this token before the table was rebuilt, as a
   * `resumeSeat` would but with nobody to answer: the client does not know
   * anything happened. False if the token no longer holds a seat here.
   */
  adoptSeat(connection: number, token: string): boolean {
    if (!this.room.resume(token).ok) return false;
    this.claim(connection, token);
    return true;
  }

  /** The connection closed. If it held a seat, the player is gone for now. */
  disconnect(connection: number): void {
    this.peers.delete(connection);
    this.sent.delete(connection);
    const token = this.unseat(connection);
    if (token === null) return;
    const player = this.room.seatOf(token);
    /* v8 ignore next -- a token still owned is still seated: leaving lets go of it first */
    if (!player) return;
    this.room.setConnected(player.seat, false);
    this.broadcastRoom();
  }

  /**
   * The table is gone — reaped, or its process moving on. Connections still open
   * to it hold nothing: every request is refused, as it would be at a code that
   * never existed, and the room is no longer told to broadcast.
   */
  retire(): void {
    this.retired = true;
    for (const [connection] of this.sessions) this.hold(connection, null);
    this.owners.clear();
    this.room.onChange = null;
  }

  /**
   * The table has been closed for being left: tell everyone at it why, then
   * retire. Without this a player looking at a paused table would find out only
   * when their next click was refused.
   */
  close(reason: CloseReason): void {
    for (const [connection] of this.sessions) this.send(connection, "tableClosed", { reason });
    this.retire();
  }

  /** Handle one request, answer it, and tell the table what changed. */
  async handle(connection: number, frame: ClientFrame): Promise<void> {
    try {
      await this.respond(connection, frame);
    } finally {
      if (!this.retired) this.hooks.changed?.();
    }
  }

  private async respond(connection: number, frame: ClientFrame): Promise<void> {
    const peer = this.peers.get(connection);
    /* v8 ignore next -- a transport delivers no message after a connection's close */
    if (!peer) return;
    const reply = (result: Ack<unknown>): void => peer.send({ ack: frame.id, result });
    if (this.retired) return reply(refusal(frame.event));
    const payload = frame.payload as Record<string, unknown> | undefined;
    const seated = this.seatOf(connection);

    switch (frame.event) {
      case "resumeSeat": {
        if (payload?.roomId !== this.room.id)
          return reply({ ok: false, error: "no room with that code" });
        const resumed = this.room.resume(String(payload?.token ?? ""));
        if (!resumed.ok) return reply({ ok: false, error: resumed.error });
        // The seat comes from the token, not from the payload's seat field: trusting
        // the field would let anyone with a valid token claim any seat in the room.
        this.claim(connection, resumed.value.token);
        reply({ ok: true, data: this.credentialsOf(resumed.value) });
        this.broadcastRoom();
        const update = this.room.viewFor(resumed.value.seat);
        if (update) peer.send({ event: "view", payload: update });
        // The result is broadcast once, when the round ends, so a seat that comes back
        // afterwards would otherwise see a finished table with no scores on it.
        const result = this.room.result();
        if (result) peer.send({ event: "roundEnded", payload: result });
        return;
      }
      case "startGame": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const started = this.room.start(seated);
        if (!started.ok) return reply({ ok: false, error: started.error });
        reply({ ok: true, data: undefined });
        this.broadcastRoom();
        this.broadcastViews();
        return;
      }
      case "submitAction": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const applied = this.room.submitAction(seated, frame.payload as never);
        reply(ackOf(applied));
        if (!applied.ok) return;
        this.broadcastViews();
        this.broadcastResult();
        return;
      }
      case "stageMelds": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        // Normalized rather than trusted: this arrives as untyped JSON, and a draft
        // that is not a list of well-formed groups is simply no draft.
        const melds = isDraft(payload?.melds) ? payload.melds : [];
        return reply(ackOf(this.room.stageMelds(seated, melds)));
      }
      case "setPaused": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const paused = this.room.setPaused(seated, payload?.paused === true);
        reply(ackOf(paused));
        if (!paused.ok) return;
        this.broadcastRoom();
        this.broadcastViews();
        return;
      }
      case "react": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const reacted = this.room.react(seated, payload?.id);
        if (!reacted.ok) return reply({ ok: false, error: reacted.error });
        reply({ ok: true, data: undefined });
        // Everyone, the sender too, so every screen shows it the same way.
        for (const [other] of this.sessions) this.send(other, "reaction", reacted.value);
        return;
      }
      case "saveForLater": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const saved = this.room.saveForLater(seated);
        reply(ackOf(saved));
        if (!saved.ok) return;
        this.broadcastRoom();
        // Saving pauses a table that was not paused, which stops every clock.
        this.broadcastViews();
        return;
      }
      case "setHost": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const changed = this.room.setHost(seated, Number(payload?.seat));
        reply(ackOf(changed));
        if (changed.ok) this.broadcastRoom();
        return;
      }
      case "addBot": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const added = this.room.addBot(seated);
        reply(added.ok ? { ok: true, data: undefined } : { ok: false, error: added.error });
        if (added.ok) this.broadcastRoom();
        return;
      }
      case "removeBot": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const before = new Map(this.room.seats().map((p) => [p.token, p.seat]));
        const removed = this.room.removeBot(seated, Number(payload?.seat));
        reply(removed.ok ? { ok: true, data: undefined } : { ok: false, error: removed.error });
        if (!removed.ok) return;
        this.tellMoved(before);
        this.broadcastRoom();
        return;
      }
      case "removePlayer": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const removed = this.room.removePlayer(seated, Number(payload?.seat));
        reply(ackOf(removed));
        if (!removed.ok) return;
        this.broadcastRoom();
        // The scoreboard shows who has gone; a next round dealt now needs views too.
        this.broadcastResult();
        this.broadcastViews();
        return;
      }
      case "nextRound": {
        if (seated === null) return reply({ ok: false, error: NOT_SEATED });
        const ready = this.room.readyForNextRound(seated);
        if (!ready.ok) return reply({ ok: false, error: ready.error });
        reply({ ok: true, data: ready.value });
        this.broadcastRoom();
        if (ready.value) this.broadcastViews();
        return;
      }
      case "playAgain": {
        const already = this.sent.get(connection);
        if (already) return reply(already);
        const token = this.sessions.get(connection);
        const player = token === undefined ? undefined : this.room.seatOf(token);
        if (token === undefined || !player) return reply({ ok: false, error: NOT_SEATED });
        if (!this.room.matchOver) return reply({ ok: false, error: "the match is not over yet" });
        const pending = this.moving.get(token);
        if (pending) return reply(this.remember(connection, await pending));
        if (this.room.hasGoneOn(token)) {
          return reply({ ok: false, error: "you have already gone on to the next game" });
        }
        const moving = this.moveOn(token, player);
        this.moving.set(token, moving);
        try {
          return reply(this.remember(connection, await moving));
        } finally {
          this.moving.delete(token);
        }
      }
      case "rematch": {
        const token = this.sessions.get(connection);
        if (token === undefined || seated === null) return reply({ ok: false, error: NOT_SEATED });
        if (this.rematching) {
          const first = await this.rematching;
          if (!first.ok) return reply({ ok: false, error: first.error });
          return reply({ ok: true, data: first.value.get(token)! });
        }
        const coming = this.room.rematchPlayers(seated);
        if (!coming.ok) return reply({ ok: false, error: coming.error });
        const opening = this.hooks.rematch(this.room, coming.value);
        this.rematching = opening;
        let moved;
        try {
          moved = await opening;
        } finally {
          this.rematching = null;
        }
        if (!moved.ok) return reply({ ok: false, error: moved.error });
        // Everyone goes at once: each connection is told its own seat there, and
        // every seat here is let go of, as a play again does for one player.
        for (const [other, held] of [...this.sessions]) {
          const seat = moved.value.get(held);
          if (seat && other !== connection) this.send(other, "rematch", seat);
        }
        for (const [moving] of moved.value) {
          this.letGo(moving);
          this.room.moveOn(moving);
        }
        reply({ ok: true, data: moved.value.get(token)! });
        this.broadcastRoom();
        return;
      }
      case "leaveRoom": {
        const token = this.sessions.get(connection);
        // Only the seat's current owner speaks for it: a connection superseded by a
        // resume elsewhere must not be able to give away a seat still in use.
        if (token === undefined || this.owners.get(token) !== connection) {
          this.hold(connection, null);
          return reply({ ok: false, error: NOT_SEATED });
        }
        // Where everyone else sits now, so the ones who move up can be told.
        const before = new Map(this.room.seats().map((p) => [p.token, p.seat]));
        const left = this.room.leave(token);
        /* v8 ignore next -- an owned token is always still seated: only its owner can leave */
        if (!left.ok) return reply({ ok: false, error: left.error });
        this.letGo(token);
        reply({ ok: true, data: undefined });
        this.tellMoved(before);
        this.broadcastRoom();
        this.broadcastViews();
        // Leaving between rounds takes the player out of the match, which the
        // scoreboard shows.
        this.broadcastResult();
        return;
      }
      default:
        return reply({ ok: false, error: `unknown request: ${frame.event}` });
    }
  }

  /** Keep a successful move's answer for this connection's repeats of it. */
  private remember(connection: number, answer: Ack<SeatCredentials>): Ack<SeatCredentials> {
    if (answer.ok) this.sent.set(connection, answer);
    return answer;
  }

  private async moveOn(token: string, player: RoomPlayer): Promise<Ack<SeatCredentials>> {
    const moved = await this.hooks.nextTable(this.room, player);
    if (!moved.ok) return { ok: false, error: moved.error };
    // Off this table, as a leave: this connection no longer speaks for the seat.
    this.letGo(token);
    this.room.moveOn(token);
    this.broadcastRoom();
    return { ok: true, data: moved.value };
  }

  /** Tell everyone at the table where things stand, as a newly wired room does. */
  broadcastRoom(): void {
    const info = this.room.info();
    for (const [connection] of this.sessions) this.send(connection, "room", info);
  }

  // ------------------------------------------------------------------ seating ---

  /** The seat a connection holds, or null. */
  private seatOf(connection: number): number | null {
    const token = this.sessions.get(connection);
    if (token === undefined) return null;
    /* v8 ignore next -- a held token is always seated: tokens let go are unheld first */
    return this.room.seatOf(token)?.seat ?? null;
  }

  private credentialsOf(player: RoomPlayer): SeatCredentials {
    return { roomId: this.room.id, seat: player.seat, token: player.token };
  }

  /** Seat this connection, taking the seat over from any that held it before. */
  private claim(connection: number, token: string): void {
    const prior = this.sessions.get(connection);
    if (prior !== undefined && prior !== token) this.disconnectSeat(connection);
    this.hold(connection, token);
    this.owners.set(token, connection);
  }

  /** The one place a connection's seat changes, so the transport always hears. */
  private hold(connection: number, token: string | null): void {
    if ((this.sessions.get(connection) ?? null) === token) return;
    if (token === null) this.sessions.delete(connection);
    else this.sessions.set(connection, token);
    this.peers.get(connection)?.seated?.(token);
  }

  /**
   * Forget this connection's seat, returning the token only if the connection was
   * still its owner — the only case in which its going says anything about the
   * player.
   */
  private unseat(connection: number): string | null {
    const token = this.sessions.get(connection);
    this.hold(connection, null);
    if (token === undefined || this.owners.get(token) !== connection) return null;
    this.owners.delete(token);
    return token;
  }

  /** Unseat a connection that is moving to another seat of this same table. */
  private disconnectSeat(connection: number): void {
    const token = this.unseat(connection);
    const player = token === null ? undefined : this.room.seatOf(token);
    if (player) this.room.setConnected(player.seat, false);
  }

  /** A token given up on purpose: no connection speaks for it any more. */
  private letGo(token: string): void {
    this.owners.delete(token);
    for (const [connection, held] of this.sessions) {
      if (held === token) this.hold(connection, null);
    }
  }

  /** Tell each seated connection whose seat number changed what it is now. */
  private tellMoved(before: ReadonlyMap<string, number>): void {
    for (const [connection, token] of this.sessions) {
      const player = this.room.seatOf(token);
      if (player && player.seat !== before.get(token)) this.send(connection, "seat", player.seat);
    }
  }

  // --------------------------------------------------------------- broadcasts ---

  private send(connection: number, event: string, payload: unknown): void {
    this.peers.get(connection)?.send({ event, payload });
  }

  /** Send each seat its own filtered view. Never build one payload for the table. */
  private broadcastViews(): void {
    for (const [connection, token] of this.sessions) {
      const player = this.room.seatOf(token);
      /* v8 ignore next -- a departed token's sessions are dropped with it */
      const update = player ? this.room.viewFor(player.seat) : null;
      if (update) this.send(connection, "view", update);
    }
  }

  private broadcastResult(): void {
    const result = this.room.result();
    if (!result) return;
    for (const [connection] of this.sessions) this.send(connection, "roundEnded", result);
  }
}
