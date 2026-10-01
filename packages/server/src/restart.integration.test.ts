/**
 * A restart, end to end: real Socket.io clients play a table on one server, that
 * server shuts down the way a deploy stops it, a new one boots from the same
 * store, and the players come back with the tokens they already hold.
 *
 * Runs against the in-memory store always, and against Postgres whenever
 * `HF_TEST_DATABASE_URL` names a database the suite may wipe — where the whole
 * path matters most, since that one really does outlive the process.
 */
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { connect as connectTransport, type TableSocket } from "@hf/transport";
import type { Ack, Action, SeatCredentials, ViewUpdate } from "@hf/shared";
import { defaultAction } from "@hf/engine";
import { createServer, type HandAndFootServer } from "./index";
import { openPostgresStore } from "./postgres";
import { ownDatabase } from "./testDatabase";
import { InMemoryRoomStore, type RoomStore } from "./store";

type Client = TableSocket;

const DATABASE_URL = process.env.HF_TEST_DATABASE_URL;

const servers: HandAndFootServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.close();
});

/** Boot a server on a store, restoring whatever it holds, as `startFromEnv` does. */
async function boot(store: RoomStore): Promise<{ server: HandAndFootServer; url: string }> {
  const server = createServer({ store });
  expect(server.manager.restore(await store.loadOpen())).toEqual([]);
  servers.push(server);
  return { server, url: `http://localhost:${await server.listen(0)}` };
}

async function shutDown(server: HandAndFootServer): Promise<void> {
  servers.splice(servers.indexOf(server), 1);
  await server.close();
}

async function connect(url: string): Promise<Client> {
  const socket: Client = connectTransport(url);
  clients.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

function ask<T>(emit: (ack: (result: Ack<T>) => void) => void): Promise<Ack<T>> {
  return new Promise((resolve) => emit(resolve));
}

function viewOf(socket: Client): Promise<ViewUpdate> {
  return new Promise((resolve) => socket.once("view", resolve));
}

/**
 * Open a three-seat table, deal, and play some turns through the sockets — so
 * the log that has to be replayed was written by the real transport.
 */
async function playATable(
  server: HandAndFootServer,
  url: string,
): Promise<{
  seats: SeatCredentials[];
  sockets: Client[];
  last: ViewUpdate[];
}> {
  const sockets = [await connect(url), await connect(url), await connect(url)];
  const created = await ask<SeatCredentials>((ack) =>
    sockets[0]!.emit("createRoom", { name: "ana", options: { mode: "family" } }, ack),
  );
  if (!created.ok) throw new Error(created.error);
  const seats = [created.data];
  for (const [i, name] of [
    [1, "ben"],
    [2, "cy"],
  ] as const) {
    const joined = await ask<SeatCredentials>((ack) =>
      sockets[i]!.emit("joinRoom", { roomId: created.data.roomId, name }, ack),
    );
    if (!joined.ok) throw new Error(joined.error);
    seats.push(joined.data);
  }

  const last: ViewUpdate[] = [];
  sockets.forEach((socket, i) => socket.on("view", (update) => (last[i] = update)));
  const dealt = viewOf(sockets[0]!);
  expect((await ask((ack) => sockets[0]!.emit("startGame", ack))).ok).toBe(true);
  await dealt;

  // Twenty moves, each by whichever seat is on turn and each sent over that
  // seat's socket. The move itself is the engine's safe default, read from the
  // server's state only to pick something legal.
  const room = server.manager.get(created.data.roomId)!;
  for (let move = 0; move < 20; move++) {
    const state = room.gameState!;
    const action: Action = defaultAction(state)!;
    const everyone = sockets.map(viewOf);
    const result = await ask((ack) =>
      sockets[state.currentSeat]!.emit("submitAction", action, ack),
    );
    expect(result, `move ${move}`).toEqual({ ok: true, data: undefined });
    await Promise.all(everyone);
  }
  return { seats, sockets, last };
}

function scenarios(
  name: string,
  freshStore: () => Promise<RoomStore>,
  reopen: () => Promise<RoomStore>,
): void {
  describe(`a restart (${name})`, () => {
    it("gives every player back the exact table they left, and lets play carry on", async () => {
      const first = await boot(await freshStore());
      const { seats, sockets, last } = await playATable(first.server, first.url);
      const before = first.server.manager.get(seats[0]!.roomId)!;
      const stateBefore = before.gameState;
      const logBefore = before.log.entries();
      for (const socket of sockets) socket.disconnect();

      // What a deploy does: the process is asked to stop, then a new one boots.
      await shutDown(first.server);
      const second = await boot(await reopen());
      const restored = second.server.manager.get(seats[0]!.roomId)!;
      expect(restored.gameState).toEqual(stateBefore);
      expect(restored.log.entries()).toEqual(logBefore);

      // Each player returns on a new socket with the token they already hold.
      const back = await Promise.all(seats.map(() => connect(second.url)));
      for (const [i, socket] of back.entries()) {
        const view = viewOf(socket);
        const resumed = await ask<SeatCredentials>((ack) =>
          socket.emit("resumeSeat", seats[i]!, ack),
        );
        expect(resumed).toEqual({ ok: true, data: seats[i] });
        const update = await view;
        // Their own hand, the table, and what they may do — all as they left it.
        expect(update.view).toEqual(last[i]!.view);
        expect(update.hints).toEqual(last[i]!.hints);
      }

      // And the game goes on from there, with the log carrying on unbroken.
      const onTurn = restored.gameState!.currentSeat;
      const phase = restored.gameState!.phase;
      const action: Action =
        phase === "draw" ? { type: "draw" } : defaultAction(restored.gameState!)!;
      const played = await ask((ack) => back[onTurn]!.emit("submitAction", action, ack));
      expect(played).toEqual({ ok: true, data: undefined });
      expect(restored.log.entries().map((row) => row.seq)).toEqual(
        Array.from({ length: logBefore.length + 1 }, (_, i) => i),
      );

      // Which is itself written through: a second restart sees that move too.
      await shutDown(second.server);
      const third = await boot(await reopen());
      expect(third.server.manager.get(seats[0]!.roomId)!.log.length).toBe(logBefore.length + 1);
    });

    it("brings a lobby back so the table can still fill up and deal", async () => {
      const first = await boot(await freshStore());
      const host = await connect(first.url);
      const created = await ask<SeatCredentials>((ack) =>
        host.emit("createRoom", { name: "ana" }, ack),
      );
      if (!created.ok) throw new Error(created.error);
      host.disconnect();
      await shutDown(first.server);

      const second = await boot(await reopen());
      const returning = await connect(second.url);
      expect((await ask((ack) => returning.emit("resumeSeat", created.data, ack))).ok).toBe(true);
      const guest = await connect(second.url);
      const joined = await ask<SeatCredentials>((ack) =>
        guest.emit("joinRoom", { roomId: created.data.roomId, name: "ben" }, ack),
      );
      expect(joined).toMatchObject({ ok: true, data: { seat: 1 } });
      expect((await ask((ack) => returning.emit("startGame", ack))).ok).toBe(true);
    });

    it("does not bring back a room that was reaped before the restart", async () => {
      const first = await boot(await freshStore());
      const room = first.server.manager.create();
      first.server.manager.remove(room.id);
      await shutDown(first.server);
      const second = await boot(await reopen());
      expect(second.server.manager.get(room.id)).toBeUndefined();
    });
  });
}

// The in-memory store survives `close`, so the same object is the "database".
{
  let shared = new InMemoryRoomStore();
  scenarios(
    "in-memory store",
    async () => (shared = new InMemoryRoomStore()),
    async () => shared,
  );
}

if (DATABASE_URL !== undefined) {
  const url = () => ownDatabase(DATABASE_URL, "hf_test_restart");
  scenarios(
    "Postgres",
    async () => {
      const admin = postgres(await url(), { max: 1, onnotice: () => {} });
      await admin`drop table if exists actions, rooms, users, schema_migrations`;
      await admin.end();
      return openPostgresStore(await url(), { retryDelaysMs: [] });
    },
    // Each boot opens its own connection, as a new process would; `close` on
    // the previous server ended the last one.
    async () => openPostgresStore(await url(), { retryDelaysMs: [] }),
  );
}
