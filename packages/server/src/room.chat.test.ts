import { describe, it, expect } from "vitest";
import { EAST_COAST, type ChatMessage } from "@hf/shared";
import { CHAT_BURST, CHAT_KEPT, CHAT_REFILL_MS, ChatLimiter } from "./chat";
import { FakeClock } from "./clock";
import { Room } from "./room";
import { InMemoryRoomStore, type StoredRoom } from "./store";

/** A store that keeps chat as the Durable Object's does, so a restore can bring it back. */
class ChatKeepingStore extends InMemoryRoomStore {
  readonly chats = new Map<string, readonly ChatMessage[]>();
  saveChat(uid: string, messages: readonly ChatMessage[]): void {
    this.chats.set(uid, JSON.parse(JSON.stringify(messages)));
  }
}

function room(clock = new FakeClock(1_000), store?: InMemoryRoomStore): Room {
  let n = 0;
  const r = new Room("CHAT22", EAST_COAST, {
    clock,
    seed: 3,
    newToken: () => `t${n++}`,
    ...(store ? { store, uid: "u1" } : {}),
  });
  r.join("ana");
  r.join("ben");
  return r;
}

function said(r: Room, seat: number, text: unknown): ChatMessage {
  const result = r.chat(seat, text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("a chat message", () => {
  it("comes from a seat, tidied, named, timed, and numbered as it comes", () => {
    const clock = new FakeClock(5_000);
    const r = room(clock);
    const first = said(r, 1, "  good   luck\nall ");
    expect(first).toEqual({ seq: 5_000, seat: 1, name: "ben", text: "good luck all", at: 5_000 });
    // Two in the same millisecond still get numbers of their own, in order.
    const second = said(r, 0, "thanks");
    expect(second.seq).toBe(5_001);
    expect(second).toMatchObject({ seat: 0, name: "ana", at: 5_000 });
    expect(r.chatHistory()).toEqual([first, second]);
  });

  it("is refused from a seat that does not exist, with nothing in it, or too long", () => {
    const r = room();
    expect(r.chat(5, "hi")).toEqual({ ok: false, error: "no such seat" });
    for (const bad of ["", "   ", "\u0000", 7, null, undefined, { text: "hi" }]) {
      expect(r.chat(0, bad)).toEqual({ ok: false, error: "there is nothing to send" });
    }
    expect(r.chat(0, "x".repeat(201))).toEqual({
      ok: false,
      error: "a message can be at most 200 characters",
    });
    // The limit counts what is left after tidying, and an emoji as one.
    expect(r.chat(0, ` ${"x".repeat(200)} `).ok).toBe(true);
    expect(r.chat(0, "🎉".repeat(200)).ok).toBe(true);
    // Refusals cost nothing and keep nothing.
    expect(r.chatHistory()).toHaveLength(2);
  });

  it("is numbered past every earlier one by a room rebuilt later, even one that kept none", () => {
    const clock = new FakeClock(1_000);
    const before = room(clock);
    const seen = [said(before, 0, "a").seq, said(before, 0, "b").seq, said(before, 0, "c").seq];
    clock.advance(10_000);
    const after = room(clock);
    expect(said(after, 1, "d").seq).toBeGreaterThan(Math.max(...seen));
  });

  it("touches nothing in the game, the log, or the stored record", () => {
    const store = new ChatKeepingStore();
    const r = room(new FakeClock(0), store);
    store.saveRoom(r.record());
    r.start(0);
    const before = { state: r.gameState, log: r.log.length, record: JSON.stringify(r.record()) };
    said(r, 0, "here we go");
    expect(r.gameState).toBe(before.state);
    expect(r.log.length).toBe(before.log);
    expect(JSON.stringify(r.record())).toBe(before.record);
    expect(JSON.stringify(r.record())).not.toContain("here we go");
  });
});

describe("what a table remembers of its chat", () => {
  it("is the last fifty messages, oldest first", () => {
    // Pinned as a literal: how much a newcomer is shown is a decision.
    expect(CHAT_KEPT).toBe(50);
    const clock = new FakeClock(0);
    const r = room(clock);
    for (let i = 0; i < 60; i++) {
      said(r, i % 2, `message ${i}`);
      clock.advance(CHAT_REFILL_MS);
    }
    const kept = r.chatHistory();
    expect(kept).toHaveLength(50);
    expect(kept[0]!.text).toBe("message 10");
    expect(kept.at(-1)!.text).toBe("message 59");
  });

  it("is handed to a store that keeps it, and comes back with the room", async () => {
    const clock = new FakeClock(1_000);
    const store = new ChatKeepingStore();
    const r = room(clock, store);
    r.start(0);
    const a = said(r, 0, "first");
    const b = said(r, 1, "second");
    expect(store.chats.get("u1")).toEqual([a, b]);
    const [stored] = await store.loadOpen();
    // Brought back on a clock behind the one the messages were numbered by, as
    // another machine's may be: it still numbers past what it brought back.
    const behind = new FakeClock(0);
    const restored = Room.restore(
      { ...stored!, chat: store.chats.get("u1") },
      { clock: behind, newToken: () => "t" },
    );
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.value.chatHistory()).toEqual([a, b]);
    expect(said(restored.value, 0, "third").seq).toBe(b.seq + 1);
  });

  it("comes back empty from a store that keeps none, as the Node server's", async () => {
    const clock = new FakeClock(1_000);
    const store = new InMemoryRoomStore();
    const r = room(clock, store);
    r.start(0);
    said(r, 0, "lost on a restart");
    const [stored] = (await store.loadOpen()) as StoredRoom[];
    expect(stored!.chat).toBeUndefined();
    const restored = Room.restore(stored!, { clock, newToken: () => "t" });
    if (!restored.ok) throw new Error(restored.error);
    expect(restored.value.chatHistory()).toEqual([]);
  });
});

describe("how often a seat may chat", () => {
  it("allows a burst of five, then one more every two seconds, per seat", () => {
    // Pinned as literals: how chatty the table may get is a decision.
    expect(CHAT_BURST).toBe(5);
    expect(CHAT_REFILL_MS).toBe(2000);
    const clock = new FakeClock(0);
    const limit = new ChatLimiter(clock);
    expect(Array.from({ length: 6 }, () => limit.take(0))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(limit.take(1)).toBe(true);
    clock.advance(1_999);
    expect(limit.take(0)).toBe(false);
    clock.advance(1);
    expect(limit.take(0)).toBe(true);
    expect(limit.take(0)).toBe(false);
    clock.advance(60_000);
    expect(Array.from({ length: 6 }, () => limit.take(0)).filter(Boolean)).toHaveLength(5);
  });

  it("is a budget of its own, apart from reactions, and refused with a reason", () => {
    const r = room();
    for (let i = 0; i < 3; i++) expect(r.react(0, "nice").ok).toBe(true);
    // Reactions spent; messages are not.
    for (let i = 0; i < CHAT_BURST; i++) said(r, 0, `hi ${i}`);
    expect(r.chat(0, "one more")).toEqual({ ok: false, error: "too many messages; wait a moment" });
    // And the other way round: messages spent leaves reactions alone.
    const other = room();
    for (let i = 0; i < CHAT_BURST; i++) said(other, 1, `hi ${i}`);
    expect(other.react(1, "nice").ok).toBe(true);
    // Another seat has its own.
    expect(r.chat(1, "my turn").ok).toBe(true);
  });
});
