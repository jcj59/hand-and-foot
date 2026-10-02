import { describe, it, expect } from "vitest";
import type { Avatar } from "@hf/shared";
import { FakeClock } from "./clock";
import { nextTableFor, openTable, sitAt } from "./lobby";
import { RoomManager } from "./manager";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";

describe("a seat's identity", () => {
  it("is kept with the seat, and comes back with it after a restart", async () => {
    const store = new InMemoryRoomStore();
    const manager = new RoomManager({ clock: new FakeClock(), store });
    const opened = openTable(manager, "Ana", undefined, { userId: "ana-user-id-0001" });
    if (!opened.ok) throw new Error(opened.error);
    expect(sitAt(manager, opened.data.roomId, "Guest", { userId: null }).ok).toBe(true);
    const [stored] = await store.loadOpen();
    expect(stored!.room.players.map((p) => p.userId)).toEqual(["ana-user-id-0001", undefined]);
    const back = Room.restore(stored!, { clock: new FakeClock(), newToken: () => "t" });
    if (!back.ok) throw new Error(back.error);
    expect(back.value.seats().map((p) => p.userId)).toEqual(["ana-user-id-0001", undefined]);
  });

  it("goes with the player to the next game's table", () => {
    const manager = new RoomManager({ clock: new FakeClock() });
    const opened = openTable(manager, "Ana", undefined, { userId: "ana-user-id-0001" });
    if (!opened.ok) throw new Error(opened.error);
    const room = manager.get(opened.data.roomId)!;
    const moved = nextTableFor(manager, room, room.seats()[0]!);
    if (!moved.ok) throw new Error(moved.error);
    const next = manager.get(moved.value.roomId)!;
    expect(next.seats()[0]!.userId).toBe("ana-user-id-0001");
  });
});

describe("a seat's picture", () => {
  const ANA: Avatar = {
    background: "rose",
    skin: "sand",
    eyes: "wink",
    mouth: "grin",
    top: "crown",
  };

  it("is shown to the whole table, and kept with the seat across a restart", async () => {
    const store = new InMemoryRoomStore();
    const manager = new RoomManager({ clock: new FakeClock(), store });
    const opened = openTable(manager, "Ana", undefined, { avatar: ANA });
    if (!opened.ok) throw new Error(opened.error);
    expect(sitAt(manager, opened.data.roomId, "Ben").ok).toBe(true);
    const room = manager.get(opened.data.roomId)!;
    expect(room.info().players.map((p) => p.avatar)).toEqual([ANA, undefined]);
    // A seat without one carries no field at all, rather than an empty one.
    expect(room.info().players[1]).not.toHaveProperty("avatar");

    const [stored] = await store.loadOpen();
    expect(stored!.room.players.map((p) => p.avatar)).toEqual([ANA, undefined]);
    const back = Room.restore(stored!, { clock: new FakeClock(), newToken: () => "t" });
    if (!back.ok) throw new Error(back.error);
    expect(back.value.info().players.map((p) => p.avatar)).toEqual([ANA, undefined]);
  });

  it("goes with the player to the next game's table", () => {
    const manager = new RoomManager({ clock: new FakeClock() });
    const opened = openTable(manager, "Ana", undefined, { avatar: ANA });
    if (!opened.ok) throw new Error(opened.error);
    const room = manager.get(opened.data.roomId)!;
    const moved = nextTableFor(manager, room, room.seats()[0]!);
    if (!moved.ok) throw new Error(moved.error);
    expect(manager.get(moved.value.roomId)!.info().players[0]!.avatar).toEqual(ANA);
  });
});
