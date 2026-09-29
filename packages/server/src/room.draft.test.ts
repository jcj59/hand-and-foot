/**
 * The staged lay-down a player had not yet played when their clock ran out.
 *
 * The staging lives in the browser; `stageMelds` keeps the server's copy current
 * so the timeout can play it. The table here has no lay-down minimum, so what is
 * and is not playable comes down to the melds themselves.
 */
import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  isWild,
  type Card,
  type MeldPlay,
  type Rank,
  type RulesConfig,
} from "@hf/shared";
import { FakeClock } from "./clock";
import { DEFAULT_RECONNECT_GRACE_MS, Room } from "./room";

const NO_MINIMUM: RulesConfig = {
  ...EAST_COAST,
  layDownMinimums: EAST_COAST.layDownMinimums.map(() => 0),
};
const { baseMs } = NO_MINIMUM.timers;

/** Run the main clock out: to the deadline the room itself reports. */
function expire(room: Room, clock: FakeClock): void {
  clock.advance(room.clockState().deadlineAt! - clock.now());
}

/** Natural cards in a zone grouped by rank, threes left out: they meld by other rules. */
function naturalsByRank(zone: readonly Card[]): Map<Rank, Card[]> {
  const byRank = new Map<Rank, Card[]>();
  for (const card of zone) {
    if (isWild(card.rank) || card.rank === "3") continue;
    byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
  }
  return byRank;
}

/**
 * A two-seat table, dealt and drawn, whose player on turn holds four or more
 * naturals of one rank and three or more of another — found by trying seeds, so the
 * fixture is a real deal rather than a hand-built one.
 */
function tableWithTwoMelds(config: RulesConfig = NO_MINIMUM): {
  room: Room;
  clock: FakeClock;
  seat: number;
  melds: [MeldPlay, MeldPlay];
  spareOfFirst: Card;
} {
  for (let seed = 1; seed < 5_000; seed++) {
    const clock = new FakeClock(1_000_000);
    let token = 0;
    const room = new Room("DRAFT1", config, { clock, seed, newToken: () => `t${token++}` });
    room.join("ana");
    room.join("ben");
    room.start(0);
    const seat = room.gameState!.currentSeat;
    room.submitAction(seat, { type: "draw" });
    const zone = room.gameState!.players[seat]!.hand;
    // Most-held first: four of one rank (so there is a spare to grow it with) and
    // at least three of another.
    const ranks = [...naturalsByRank(zone)].sort(([, a], [, b]) => b.length - a.length);
    if (ranks.length < 2 || ranks[0]![1].length < 4 || ranks[1]![1].length < 3) continue;
    const [[firstRank, first], [secondRank, second]] = ranks as [[Rank, Card[]], [Rank, Card[]]];
    return {
      room,
      clock,
      seat,
      melds: [
        { rank: firstRank, cardIds: first.slice(0, 3).map((c) => c.id) },
        { rank: secondRank, cardIds: second.slice(0, 3).map((c) => c.id) },
      ],
      spareOfFirst: first[3]!,
    };
  }
  throw new Error("no seed deals two meldable ranks");
}

describe("a staged lay-down when the clock runs out", () => {
  it("is played for the player, logged as the timeout's doing", () => {
    const { room, clock, seat, melds } = tableWithTwoMelds();
    expect(room.stageMelds(seat, melds).ok).toBe(true);
    expire(room, clock);

    const played = room.log.entries().at(-1)!;
    expect(played.action).toEqual({ type: "playMelds", melds });
    expect(played.source).toBe("timeout");
    expect(room.gameState!.players[seat]!.melds.map((m) => m.rank).sort()).toEqual(
      melds.map((m) => m.rank).sort(),
    );
    // Then the turn goes on as any timeout does: still theirs, discard only.
    expect(room.gameState!.currentSeat).toBe(seat);
    expect(room.clockState().inDiscardGrace).toBe(true);
  });

  it("plays the part that is legal when one group is not ready", () => {
    // Two finished melds and a pair: the pair cannot go down, the rest can.
    const { room, clock, seat, melds } = tableWithTwoMelds();
    const zone = room.gameState!.players[seat]!.hand;
    const taken = new Set(melds.flatMap((m) => m.cardIds));
    const pairRank = [...naturalsByRank(zone.filter((c) => !taken.has(c.id)))].find(
      ([rank, cards]) => cards.length >= 2 && !melds.some((m) => m.rank === rank),
    );
    const pair: MeldPlay[] = pairRank
      ? [{ rank: pairRank[0], cardIds: pairRank[1].slice(0, 2).map((c) => c.id) }]
      : [];
    expect(pair).toHaveLength(1);

    room.stageMelds(seat, [melds[0], ...pair, melds[1]]);
    expire(room, clock);
    const played = room.log.entries().at(-1)!;
    expect(played.action).toEqual({ type: "playMelds", melds: [melds[0], melds[1]] });
  });

  it("prefers the part with the most cards when only some combination is legal", () => {
    // Four of the first rank and three of the second, both valid alone; staged
    // together with a bad group, the largest acceptable part is both good groups.
    const { room, clock, seat, melds, spareOfFirst } = tableWithTwoMelds();
    const bigger: MeldPlay = { ...melds[0], cardIds: [...melds[0].cardIds, spareOfFirst.id] };
    const bogus: MeldPlay = { rank: melds[1].rank, cardIds: ["not-a-card"] };
    room.stageMelds(seat, [bogus, bigger, melds[1]]);
    expire(room, clock);
    expect(room.log.entries().at(-1)!.action).toEqual({
      type: "playMelds",
      melds: [bigger, melds[1]],
    });
  });

  it("plays nothing when no part of it is legal", () => {
    const { room, clock, seat } = tableWithTwoMelds(EAST_COAST);
    const before = room.log.length;
    // A single card is never a meld, whatever the minimum.
    const zone = room.gameState!.players[seat]!.hand;
    const lone = zone.find((c) => !isWild(c.rank) && c.rank !== "3")!;
    room.stageMelds(seat, [{ rank: lone.rank, cardIds: [lone.id] }]);
    expire(room, clock);
    expect(
      room.log
        .entries()
        .slice(before)
        .some((row) => row.action.type === "playMelds"),
    ).toBe(false);
    expect(room.clockState().inDiscardGrace).toBe(true);
  });

  it.each([
    ["a group that is not an object", (m: MeldPlay) => [m, 7]],
    ["a group with no rank", (m: MeldPlay) => [m, { cardIds: m.cardIds }]],
    ["a card id that is not a string", (m: MeldPlay) => [m, { ...m, cardIds: [1, 2, 3] }]],
    ["a draft that is not a list", (m: MeldPlay) => ({ 0: m, length: 1 })],
  ])("discards the whole draft when it holds %s", (_, malformed) => {
    const { room, clock, seat, melds } = tableWithTwoMelds();
    const before = room.log.length;
    expect(room.stageMelds(seat, malformed(melds[0]) as unknown as MeldPlay[]).ok).toBe(true);
    expire(room, clock);
    expect(
      room.log
        .entries()
        .slice(before)
        .some((row) => row.action.type === "playMelds"),
    ).toBe(false);
    expect(room.clockState().inDiscardGrace).toBe(true);
  });

  it("is not played when the player commits it themselves first", () => {
    const { room, clock, seat, melds } = tableWithTwoMelds();
    room.stageMelds(seat, melds);
    expect(room.submitAction(seat, { type: "playMelds", melds }).ok).toBe(true);
    const logged = room.log.length;
    expire(room, clock);
    // The expiry finds the cards gone from the hand and plays no second copy.
    expect(
      room.log
        .entries()
        .slice(logged)
        .filter((row) => row.action.type === "playMelds"),
    ).toEqual([]);
  });

  it("is forgotten once the turn passes, never played on the player's next turn", () => {
    const { room, clock, seat, melds } = tableWithTwoMelds();
    room.stageMelds(seat, melds);
    const zone = room.gameState!.players[seat]!.hand;
    const staged = new Set(melds.flatMap((m) => m.cardIds));
    const discard = zone.find((c) => !staged.has(c.id))!;
    expect(room.submitAction(seat, { type: "discard", cardId: discard.id }).ok).toBe(true);
    // The other player draws and times out their whole turn; then it is this
    // player's turn again, and they draw and time out without staging anything.
    const other = room.gameState!.currentSeat;
    room.submitAction(other, { type: "draw" });
    clock.advance(10 * baseMs);
    while (room.gameState!.currentSeat !== seat) clock.advance(baseMs);
    room.submitAction(seat, { type: "draw" });
    const logged = room.log.length;
    expire(room, clock);
    expect(
      room.log
        .entries()
        .slice(logged)
        .filter((row) => row.action.type === "playMelds"),
    ).toEqual([]);
  });

  it("an empty draft clears the staged one", () => {
    const { room, clock, seat, melds } = tableWithTwoMelds();
    room.stageMelds(seat, melds);
    room.stageMelds(seat, []);
    const logged = room.log.length;
    expire(room, clock);
    expect(
      room.log
        .entries()
        .slice(logged)
        .filter((row) => row.action.type === "playMelds"),
    ).toEqual([]);
  });
});

describe("a staged lay-down when the player drops", () => {
  it("is played when the server takes the turn over, before the rest of it", () => {
    // What a player who lost their connection mid-turn would have wanted: the
    // melds they had ready go down, then the turn is finished for them.
    const { room, clock, seat, melds } = tableWithTwoMelds();
    room.stageMelds(seat, melds);
    room.setConnected(seat, false);
    // Keep the other seat present, or the table is abandoned and goes quiet.
    clock.advance(DEFAULT_RECONNECT_GRACE_MS);
    const forced = room.log.entries().filter((row) => row.source === "disconnect");
    expect(forced[0]?.action).toEqual({ type: "playMelds", melds });
    expect(forced.at(-1)?.action.type).toBe("discard");
    expect(room.gameState!.currentSeat).not.toBe(seat);
  });
});

describe("stageMelds refuses", () => {
  it("another seat's turn", () => {
    const { room, seat, melds } = tableWithTwoMelds();
    expect(room.stageMelds(1 - seat, melds)).toEqual({ ok: false, error: "it is not your turn" });
  });

  it("the draw phase, before there is anything to meld with", () => {
    const clock = new FakeClock();
    const room = new Room("DRAFT2", NO_MINIMUM, { clock, seed: 3, newToken: () => "t" });
    room.join("ana");
    room.join("ben");
    expect(room.stageMelds(0, [])).toEqual({ ok: false, error: "there is no hand in play" });
    room.start(0);
    expect(room.stageMelds(room.gameState!.currentSeat, [])).toEqual({
      ok: false,
      error: "melds can only be staged after drawing",
    });
  });

  it("the discard-only grace, when melding is already closed", () => {
    const { room, clock, seat, melds } = tableWithTwoMelds();
    expire(room, clock);
    expect(room.clockState().inDiscardGrace).toBe(true);
    expect(room.stageMelds(seat, melds)).toEqual({
      ok: false,
      error: "your turn is out of time: you can only discard",
    });
  });
});
