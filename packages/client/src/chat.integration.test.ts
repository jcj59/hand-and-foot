// @vitest-environment node
// Against a real server, so in Node rather than the simulated browser: Node's own
// WebSocket and jsdom each bring an Event class, and neither accepts the other's.
/**
 * Chat at the table through the client's own action layer, transport and session
 * store, against a real server: what one player says reaches the others and comes
 * back to them, a refusal comes back to the sender as words to show, a watcher
 * reads along but cannot send, and a tab that reconnects is handed the history.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type HandAndFootServer } from "@hf/server";
import type { ChatMessage } from "@hf/shared";
import { reclaimOnReconnect, sendChat } from "./actions";
import { attachSession, useSession } from "./session";
import { connect, createRoom, joinRoom, startGame, watchRoom, type HfClientSocket } from "./socket";

let server: HandAndFootServer;
let url: string;
const sockets: HfClientSocket[] = [];
const teardowns: (() => void)[] = [];

async function open(): Promise<HfClientSocket> {
  const socket = connect(url);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

/** Ana's tab on the store, as `App` wires it; Ben's messages collected by hand. */
async function dealtTable(): Promise<{
  ana: HfClientSocket;
  ben: HfClientSocket;
  heardByBen: ChatMessage[];
  roomId: string;
}> {
  const ana = await open();
  const ben = await open();
  const store = useSession.getState();
  teardowns.push(attachSession(ana, store));
  teardowns.push(
    reclaimOnReconnect(ana, {
      credentials: () => useSession.getState().credentials,
      seat: store.seat,
      leave: store.leave,
      setNotice: store.setNotice,
    }),
  );
  const heardByBen: ChatMessage[] = [];
  ben.on("chat", (m) => heardByBen.push(m));
  const created = await createRoom(ana, "ana", { mode: "family" });
  if (!created.ok) throw new Error(created.error);
  useSession.getState().seat(created.data);
  const joined = await joinRoom(ben, created.data.roomId, "ben");
  if (!joined.ok) throw new Error(joined.error);
  const started = await startGame(ana);
  if (!started.ok) throw new Error(started.error);
  return { ana, ben, heardByBen, roomId: created.data.roomId };
}

const texts = (): string[] => useSession.getState().chat.map((m) => m.text);

beforeEach(async () => {
  useSession.getState().leave();
  server = createServer();
  url = `http://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  for (const teardown of teardowns.splice(0)) teardown();
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
  useSession.getState().leave();
});

describe("chat at the table, against a real server", () => {
  it("carries a line from one player to the other, and back to the sender", async () => {
    const { ana, ben, heardByBen } = await dealtTable();

    expect(await sendChat(ana, "  good   luck  ")).toBeNull();
    await vi.waitFor(() => expect(heardByBen.map((m) => m.text)).toEqual(["good luck"]));
    await vi.waitFor(() => expect(texts()).toEqual(["good luck"]));
    expect(useSession.getState().chat[0]).toMatchObject({ seat: 0, name: "ana" });

    expect(await sendChat(ben, "thanks")).toBeNull();
    await vi.waitFor(() => expect(texts()).toEqual(["good luck", "thanks"]));
    expect(useSession.getState().chat[1]).toMatchObject({ seat: 1, name: "ben" });
    // Taking the seat handed Ana the table's (empty) history, so all of this is news.
    expect(useSession.getState().chatHistoryThrough).toBe(0);
  });

  it("hands a refusal back to the sender, and says nothing to the table", async () => {
    const { ben, heardByBen } = await dealtTable();

    expect(await sendChat(ben, "a".repeat(201))).toBe("a message can be at most 200 characters");
    // The server's own budget: five at once, then a wait.
    for (let i = 1; i <= 5; i++) expect(await sendChat(ben, `line ${i}`)).toBeNull();
    expect(await sendChat(ben, "one too many")).toBe("too many messages; wait a moment");
    await vi.waitFor(() => expect(texts()).toHaveLength(5));
    expect(texts()).not.toContain("one too many");
    expect(heardByBen.map((m) => m.text)).not.toContain("one too many");
    expect(useSession.getState().notice).toBeNull();
  });

  it("gives a watcher the history and every new line, but no way to speak", async () => {
    const { ana, roomId } = await dealtTable();
    expect(await sendChat(ana, "before you came")).toBeNull();

    const watcher = await open();
    const backlogs: (readonly ChatMessage[])[] = [];
    const heard: ChatMessage[] = [];
    watcher.on("chatBacklog", (ms) => backlogs.push(ms));
    watcher.on("chat", (m) => heard.push(m));
    const watched = await watchRoom(watcher, roomId);
    expect(watched.ok).toBe(true);
    await vi.waitFor(() =>
      expect(backlogs.at(-1)?.map((m) => m.text)).toEqual(["before you came"]),
    );

    expect(await sendChat(ana, "hello watcher")).toBeNull();
    await vi.waitFor(() => expect(heard.map((m) => m.text)).toEqual(["hello watcher"]));
    const refused = await sendChat(watcher, "can I play?");
    expect(refused).not.toBeNull();
    expect(texts()).not.toContain("can I play?");
  });

  it("hands a tab that reconnects what was said while it was away", async () => {
    const { ana, ben } = await dealtTable();
    expect(await sendChat(ben, "first")).toBeNull();
    await vi.waitFor(() => expect(texts()).toEqual(["first"]));

    const back = new Promise<void>((resolve) => ana.once("connect", () => resolve()));
    ana.dropConnection();
    // Said while Ana's connection is down: only the history can bring it.
    expect(await sendChat(ben, "while you were out")).toBeNull();
    await back;

    await vi.waitFor(() => expect(texts()).toEqual(["first", "while you were out"]));
    // In the list, though as history: it does not pop up by Ben's seat now.
    const missed = useSession.getState().chat[1]!;
    expect(useSession.getState().chatHistoryThrough).toBe(missed.seq);
  });
});
