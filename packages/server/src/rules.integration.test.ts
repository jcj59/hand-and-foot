/**
 * A table's rules, checked by the server over the real wire.
 *
 * The rules editor checks the same things as the player types, but a form is only
 * a convenience: anything can be posted to the open-a-table endpoint, so what is
 * tested here is what the server does with it — raw HTTP for the requests no
 * client would build, and the real client transport for the ones it does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { connect as connectTransport, type TableSocket } from "@hf/transport";
import {
  EAST_COAST,
  ROOMS_PATH,
  type Ack,
  type RoomInfo,
  type RoomOptions,
  type SeatCredentials,
  type ViewUpdate,
} from "@hf/shared";
import { createServer, FakeClock, type HandAndFootServer } from "./index";
import { nextTableFor } from "./lobby";
import { InMemoryRoomStore } from "./store";

const started: HandAndFootServer[] = [];
const clients: TableSocket[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  for (const s of started.splice(0)) await s.close();
});

async function boot(store = new InMemoryRoomStore()): Promise<{
  server: HandAndFootServer;
  port: number;
  store: InMemoryRoomStore;
}> {
  // A fake clock, so the turn clock below reads exactly what the rules set.
  const server = createServer({ store, clock: new FakeClock() });
  started.push(server);
  return { server, port: await server.listen(0), store };
}

/** Open a table with a body the test writes by hand, as anyone with curl could. */
async function post(port: number, body: unknown): Promise<Ack<SeatCredentials>> {
  const response = await fetch(`http://localhost:${port}${ROOMS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Ack<SeatCredentials>;
}

async function connect(port: number): Promise<TableSocket> {
  const socket = connectTransport(`http://localhost:${port}`);
  clients.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

function ask<T>(emit: (ack: (result: Ack<T>) => void) => void): Promise<Ack<T>> {
  return new Promise((resolve) => emit(resolve));
}

describe("rules that do not check out, posted straight to the server", () => {
  const refused: readonly [string, unknown, string][] = [
    [
      "a hand too big to deal",
      { rules: { handSize: 60 } },
      "the hand size must be between 5 and 20",
    ],
    [
      "a fraction of a deck",
      { rules: { extraDecks: 1.5 } },
      "the number of extra decks must be a whole number",
    ],
    [
      "a turn of a second",
      { rules: { timers: { baseMs: 1_000 } } },
      "the time per turn must be between 10 and 600 seconds",
    ],
    [
      "a turn that ends before it starts",
      { rules: { timers: { baseMs: 300_000, capMs: 200_000 } } },
      "the longest a turn may last cannot be less than the time per turn",
    ],
    [
      "more rounds than minimums",
      { rules: { rounds: 6 } },
      "give a lay-down minimum for each of the 6 rounds",
    ],
    [
      "a positive red three",
      { rules: { scoring: { redThree: 500 } } },
      "a red three's value must be between -1000 and 0",
    ],
    [
      "a competitive table that can be paused",
      { mode: "competitive", rules: { pauseEnabled: true } },
      "a competitive table cannot be paused; choose the family mode to allow pausing",
    ],
    [
      "going out with no books",
      { rules: { goOutCleanBooks: 0, goOutDirtyBooks: 0 } },
      "going out must need at least one book",
    ],
    [
      "a rule that does not exist",
      { rules: { jokersWild: false } },
      'there is no rule called "jokersWild"',
    ],
    [
      "a variant that does not exist",
      { preset: "south-coast" },
      "the variant must be East Coast or West Coast",
    ],
    ["a mode that does not exist", { mode: "speed" }, "the mode must be family or competitive"],
    ["options that are not an object", "fast", "the table's rules were not understood"],
  ];

  for (const [what, options, error] of refused) {
    it(`refuses ${what}, says why, and opens nothing`, async () => {
      const { server, port, store } = await boot();
      expect(await post(port, { name: "ana", options })).toEqual({ ok: false, error });
      expect(server.manager.size).toBe(0);
      expect(await store.loadOpen()).toEqual([]);
    });
  }

  it("refuses a body reaching for the prototype", async () => {
    // Written as text: JSON.stringify would drop a `__proto__` key, the parser keeps it.
    const { server, port } = await boot();
    const body = '{"name":"ana","options":{"rules":{"__proto__":{"handSize":3}}}}';
    expect(await post(port, body)).toEqual({
      ok: false,
      error: 'there is no rule called "__proto__"',
    });
    expect(server.manager.size).toBe(0);
    // And nothing anywhere picked it up.
    expect(({} as Record<string, unknown>).handSize).toBeUndefined();
  });

  it("opens the preset when no options are sent at all", async () => {
    const { server, port } = await boot();
    const opened = await post(port, { name: "ana" });
    if (!opened.ok) throw new Error(opened.error);
    expect(server.manager.get(opened.data.roomId)!.config).toEqual(EAST_COAST);
  });
});

describe("a table opened with rules of its own, over the client transport", () => {
  const options: RoomOptions = {
    preset: "west-coast",
    mode: "family",
    rules: {
      handSize: 9,
      footSize: 7,
      rounds: 2,
      layDownMinimums: [30, 60],
      wildRatio: "naturals-exceed-wilds",
      scoring: { cleanBookBonus: 400 },
      timers: { baseMs: 40_000, incrementMs: 5_000 },
    },
  };

  it("is refused through the client too, with the same reason", async () => {
    const { port } = await boot();
    const socket = await connect(port);
    const result = await ask<SeatCredentials>((ack) =>
      socket.emit("createRoom", { name: "ana", options: { rules: { handSize: 4 } } }, ack),
    );
    expect(result).toEqual({ ok: false, error: "the hand size must be between 5 and 20" });
  });

  it("shows every player those rules, and deals and times the game by them", async () => {
    const { server, port, store } = await boot();
    const host = await connect(port);
    const created = await ask<SeatCredentials>((ack) =>
      host.emit("createRoom", { name: "ana", options }, ack),
    );
    if (!created.ok) throw new Error(created.error);
    const expected = {
      ...EAST_COAST,
      ...options.rules,
      preset: "west-coast",
      scoring: { ...EAST_COAST.scoring, cleanBookBonus: 400 },
      timers: { ...EAST_COAST.timers, baseMs: 40_000, incrementMs: 5_000 },
    };

    // The guest, who chose nothing, is told the table's rules in full.
    const guest = await connect(port);
    const joined = await ask<SeatCredentials>((ack) =>
      guest.emit("joinRoom", { roomId: created.data.roomId, name: "ben" }, ack),
    );
    if (!joined.ok) throw new Error(joined.error);
    const lobby = new Promise<RoomInfo>((resolve) => guest.once("room", resolve));
    expect((await ask((ack) => guest.emit("resumeSeat", joined.data, ack))).ok).toBe(true);
    expect((await lobby).config).toEqual(expected);

    // Stored whole, so a restart replays under the same rules.
    const [record] = await store.loadOpen();
    expect(record!.room.config).toEqual(expected);

    const dealt = new Promise<ViewUpdate>((resolve) => guest.once("view", resolve));
    expect((await ask((ack) => host.emit("startGame", ack))).ok).toBe(true);
    const view = await dealt;
    expect(view.room.config).toEqual(expected);
    // Nine in hand, seven in the foot: dealt by the table's numbers, not the preset's.
    expect(view.view.footCount).toBe(7);
    expect(view.view.hand.length + view.view.opponents[0]!.handCount).toBe(9 + 9);
    // The first turn's clock starts at forty seconds.
    const { clock } = view;
    expect(clock.deadlineAt! - clock.serverNow).toBe(40_000);
    expect(server.manager.get(created.data.roomId)!.config).toEqual(expected);
  });

  it("carries the same rules to the next game's table", async () => {
    const { server, port } = await boot();
    const opened = await post(port, { name: "ana", options });
    if (!opened.ok) throw new Error(opened.error);
    const room = server.manager.get(opened.data.roomId)!;
    expect(room.config.handSize).toBe(9);
    const moved = nextTableFor(server.manager, room, room.seats()[0]!);
    if (!moved.ok) throw new Error(moved.error);
    expect(server.manager.get(moved.value.roomId)!.config).toEqual(room.config);
  });
});
