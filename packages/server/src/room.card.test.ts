/** A player changing their own card (name and picture) in the waiting room. */
import { describe, it, expect } from "vitest";
import { EAST_COAST, defaultAvatar } from "@hf/shared";
import { FakeClock } from "./clock";
import { Room } from "./room";

function lobby(): Room {
  let token = 0;
  const room = new Room("CARD23", EAST_COAST, {
    clock: new FakeClock(0),
    seed: 1,
    newToken: () => `t${token++}`,
  });
  room.join("ana", { avatar: defaultAvatar("x") });
  room.join("ben");
  return room;
}

describe("changing your card", () => {
  it("changes the name, tidied, and the picture, before the deal", () => {
    const room = lobby();
    const picture = defaultAvatar("someone else");
    expect(room.changeCard(1, { name: "  Benny   B ", avatar: picture }).ok).toBe(true);
    expect(room.info().players[1]).toMatchObject({ name: "Benny B", avatar: picture });
  });

  it("leaves what is not asked about, and null puts back the drawn picture", () => {
    const room = lobby();
    room.changeCard(0, { name: "Annie" });
    expect(room.info().players[0]!.avatar).toEqual(defaultAvatar("x"));
    room.changeCard(0, { avatar: null });
    expect(room.info().players[0]).not.toHaveProperty("avatar");
    expect(room.info().players[0]!.name).toBe("Annie");
  });

  it("refuses a blank name, a computer's seat, and anything after the deal", () => {
    const room = lobby();
    expect(room.changeCard(1, { name: "   " })).toEqual({
      ok: false,
      error: "your name can't be blank",
    });
    room.addBot(0);
    expect(room.changeCard(2, { name: "x" })).toEqual({ ok: false, error: "no such seat" });
    expect(room.changeCard(9, { name: "x" })).toEqual({ ok: false, error: "no such seat" });
    room.start(0);
    expect(room.changeCard(1, { name: "late" })).toEqual({
      ok: false,
      error: "your card can only be changed before the deal",
    });
  });
});
