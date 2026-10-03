/**
 * The parts of `TableChannel` only a transport whose table can sleep uses: telling
 * it which seat each connection holds, and seating connections again when the
 * table is rebuilt around sockets that stayed open. Everything else the channel
 * does is exercised over real sockets in the integration suites.
 */
import { describe, it, expect } from "vitest";
import { EAST_COAST, type ServerFrame } from "@hf/shared";
import { FakeClock } from "./clock";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";
import { NOT_SEATED, TableChannel, type Peer } from "./table";

const noNextTable = {
  nextTable: () => Promise.resolve({ ok: false as const, error: "no" }),
  rematch: () => Promise.resolve({ ok: false as const, error: "no" }),
};

/** A peer that remembers what it was sent and which seat it was told it holds. */
function peer(): Peer & { frames: ServerFrame[]; held: (string | null)[] } {
  const frames: ServerFrame[] = [];
  const held: (string | null)[] = [];
  return { frames, held, send: (f) => frames.push(f), seated: (t) => held.push(t) };
}

function table(names: readonly string[], store = new InMemoryRoomStore()) {
  let n = 0;
  const room = new Room("TBL234", EAST_COAST, {
    clock: new FakeClock(),
    seed: 1,
    newToken: () => `tok-${n++}`,
    store,
  });
  store.saveRoom(room.record());
  for (const name of names) room.join(name);
  return { room, store, channel: new TableChannel(room, noNextTable) };
}

let frameId = 1;
function ask(channel: TableChannel, conn: number, event: string, payload?: unknown) {
  return channel.handle(conn, { id: frameId++, event, payload });
}

describe("telling the transport which seat a connection holds", () => {
  it("on claiming a seat, moving to another, and leaving", async () => {
    const { channel } = table(["ana", "ben"]);
    const p = peer();
    const conn = channel.connect(p);
    await ask(channel, conn, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    await ask(channel, conn, "resumeSeat", { roomId: "TBL234", token: "tok-1" });
    // Presenting the same token again changes nothing, so says nothing.
    await ask(channel, conn, "resumeSeat", { roomId: "TBL234", token: "tok-1" });
    await ask(channel, conn, "leaveRoom");
    expect(p.held).toEqual(["tok-0", null, "tok-1", null]);
  });

  it("when another connection takes the seat over, and when the table retires", async () => {
    const { channel } = table(["ana"]);
    const [first, second] = [peer(), peer()];
    const a = channel.connect(first);
    const b = channel.connect(second);
    await ask(channel, a, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    await ask(channel, b, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    // The superseded connection still thinks it holds the seat until it tries to
    // leave, which is refused and forgets it.
    await ask(channel, a, "leaveRoom");
    expect(first.held).toEqual(["tok-0", null]);
    channel.retire();
    expect(second.held).toEqual(["tok-0", null]);
  });

  it("is optional: a transport that never sleeps need not listen", async () => {
    const { channel } = table(["ana"]);
    const frames: ServerFrame[] = [];
    const conn = channel.connect({ send: (f) => frames.push(f) });
    await ask(channel, conn, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    expect(frames[0]).toMatchObject({ result: { ok: true } });
  });
});

describe("a table rebuilt around connections that stayed open", () => {
  async function rebuilt(store: InMemoryRoomStore): Promise<TableChannel> {
    const [stored] = await store.loadOpen();
    const restored = Room.restore(stored!, { clock: new FakeClock(), newToken: () => "x", store });
    return new TableChannel((restored as { value: Room }).value, noNextTable);
  }

  it("seats each connection again, silently, and numbers new ones past them", async () => {
    const { store, room } = table(["ana", "ben"]);
    room.start(0);
    const channel = await rebuilt(store);
    expect(channel.room.seats().every((p) => !p.connected)).toBe(true);

    const [ana, ben] = [peer(), peer()];
    channel.connect(ana, 7);
    channel.connect(ben, 3);
    expect(channel.adoptSeat(7, "tok-0")).toBe(true);
    expect(channel.adoptSeat(3, "tok-1")).toBe(true);
    expect(channel.room.seats().map((p) => p.connected)).toEqual([true, true]);
    // Nobody is told: as far as the clients know, nothing happened.
    expect([...ana.frames, ...ben.frames]).toEqual([]);

    // They are seated for real: a move goes through, and each sees only its own hand.
    const newcomer = channel.connect(peer());
    expect(newcomer).toBe(8);
    await ask(channel, 7, "submitAction", { type: "draw" });
    expect(ana.frames[0]).toMatchObject({ result: { ok: true } });
    const views = (frames: ServerFrame[]) =>
      frames.flatMap((f) => ("event" in f && f.event === "view" ? [f.payload] : []));
    expect(views(ana.frames).at(-1)).toMatchObject({ view: { seat: 0 } });
    expect(views(ben.frames).at(-1)).toMatchObject({ view: { seat: 1 } });
  });

  it("refuses a token that no longer holds a seat here", async () => {
    const { store } = table(["ana"]);
    const channel = await rebuilt(store);
    const p = peer();
    channel.connect(p, 1);
    expect(channel.adoptSeat(1, "tok-9")).toBe(false);
    await ask(channel, 1, "startGame");
    expect(p.frames[0]).toMatchObject({ result: { ok: false } });
  });
});

describe("going on to the next game", () => {
  function finishedTable() {
    const { room, store } = table(["ana", "ben"]);
    room.start(0);
    const internal = room as unknown as { state: object };
    internal.state = { ...room.gameState!, roundEnded: true, roundNumber: room.config.rounds };
    let calls = 0;
    let open: () => void = () => undefined;
    const channel = new TableChannel(room, {
      nextTable: async () => {
        calls++;
        await new Promise<void>((resolve) => (open = resolve));
        return { ok: true, value: { roomId: "NXT234", seat: calls - 1, token: `next-${calls}` } };
      },
      rematch: () => Promise.resolve({ ok: false as const, error: "no" }),
    });
    return { room, store, channel, calls: () => calls, open: () => open() };
  }

  it("seats a player who asks twice at once only once, and answers both alike", async () => {
    const { channel, calls, open } = finishedTable();
    const p = peer();
    const conn = channel.connect(p);
    await ask(channel, conn, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    const first = ask(channel, conn, "playAgain");
    const second = ask(channel, conn, "playAgain");
    await new Promise((resolve) => setTimeout(resolve, 0));
    open();
    await Promise.all([first, second]);
    expect(calls()).toBe(1);
    const answers = p.frames.filter((f) => "ack" in f).slice(1);
    const expected = { ok: true, data: { roomId: "NXT234", seat: 0, token: "next-1" } };
    expect(answers.map((f) => ("ack" in f ? f.result : null))).toEqual([expected, expected]);
  });

  it("gives a click that arrives after the move the same answer, not a refusal", async () => {
    // A double click whose second half lands once the first has finished — the
    // seat here is already let go by then. Found on CI's faster runner.
    const { channel, calls, open } = finishedTable();
    const p = peer();
    const conn = channel.connect(p);
    await ask(channel, conn, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    const first = ask(channel, conn, "playAgain");
    await new Promise((resolve) => setTimeout(resolve, 0));
    open();
    await first;
    await ask(channel, conn, "playAgain");
    expect(calls()).toBe(1);
    const answers = p.frames.filter((f) => "ack" in f).slice(1);
    const expected = { ok: true, data: { roomId: "NXT234", seat: 0, token: "next-1" } };
    expect(answers.map((f) => ("ack" in f ? f.result : null))).toEqual([expected, expected]);
  });

  it("refuses a player who has gone on and then comes back to ask again", async () => {
    const { channel, calls, open } = finishedTable();
    const p = peer();
    const conn = channel.connect(p);
    await ask(channel, conn, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    const moved = ask(channel, conn, "playAgain");
    await new Promise((resolve) => setTimeout(resolve, 0));
    open();
    await moved;
    const q = peer();
    const again = channel.connect(q);
    await ask(channel, again, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    await ask(channel, again, "playAgain");
    expect(q.frames.find((f) => "ack" in f && f.ack === frameId - 1)).toMatchObject({
      result: { ok: false, error: "you have already gone on to the next game" },
    });
    expect(calls()).toBe(1);
  });
});

describe("closing a table that was left", () => {
  it("tells everyone seated why, then refuses whatever comes after", async () => {
    const { channel } = table(["ana", "ben"]);
    const [ana, stranger] = [peer(), peer()];
    const a = channel.connect(ana);
    channel.connect(stranger);
    await ask(channel, a, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    channel.close("paused");
    expect(ana.frames.at(-1)).toEqual({ event: "tableClosed", payload: { reason: "paused" } });
    // Only seated connections are at the table to be told.
    expect(stranger.frames).toEqual([]);
    await ask(channel, a, "startGame");
    expect(ana.frames.at(-1)).toMatchObject({ result: { ok: false } });
  });
});

describe("saving a game for later", () => {
  it("is asked for over the channel, and everyone sees until when", async () => {
    const { channel, room } = table(["ana", "ben"]);
    const [ana, ben] = [peer(), peer()];
    const a = channel.connect(ana);
    const b = channel.connect(ben);
    await ask(channel, a, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    await ask(channel, b, "resumeSeat", { roomId: "TBL234", token: "tok-1" });
    await ask(channel, a, "saveForLater");
    expect(ana.frames.at(-1)).toMatchObject({
      result: { ok: false, error: "the game has not started" },
    });
    await ask(channel, a, "startGame");
    // Mid-turn, with no pause first: saving pauses it too.
    await ask(channel, b, "saveForLater");
    expect(ben.frames.filter((f) => "ack" in f).at(-1)).toMatchObject({ result: { ok: true } });
    const savedUntil = room.info().savedUntil;
    expect(savedUntil).not.toBeNull();
    expect(ana.frames).toContainEqual(
      expect.objectContaining({ event: "room", payload: expect.objectContaining({ savedUntil }) }),
    );
    // The clock everyone sees stops with it.
    expect(ana.frames.at(-1)).toMatchObject({
      event: "view",
      payload: { clock: { paused: true, deadlineAt: null }, room: { savedUntil } },
    });
    // A connection holding no seat cannot.
    const nobody = peer();
    await ask(channel, channel.connect(nobody), "saveForLater");
    expect(nobody.frames.at(-1)).toMatchObject({ result: { ok: false, error: NOT_SEATED } });
  });

  it("lets the host know after every request, and after moves the server makes", async () => {
    const { room } = table(["ana", "ben"]);
    let changes = 0;
    const channel = new TableChannel(room, { ...noNextTable, changed: () => changes++ });
    const a = channel.connect(peer());
    await ask(channel, a, "resumeSeat", { roomId: "TBL234", token: "tok-0" });
    expect(changes).toBe(1);
    room.onChange?.();
    expect(changes).toBe(2);
    // Not once the table is closed: there is nothing left to schedule.
    channel.close("abandoned");
    await ask(channel, a, "startGame");
    expect(changes).toBe(2);
  });
});
