import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { defaultAction } from "@hf/engine";
import { FakeClock } from "./clock";
import { Room } from "./room";

const T0 = 1_000_000;
const { baseMs, incrementMs, capMs, discardGraceMs } = EAST_COAST.timers;

let tokens = 0;
function newRoom(
  over: Partial<RulesConfig> = {},
  clock = new FakeClock(T0),
  reconnectGraceMs?: number,
): { room: Room; clock: FakeClock } {
  tokens = 0;
  const room = new Room(
    "CLOCK1",
    { ...EAST_COAST, ...over },
    {
      clock,
      seed: 7,
      newToken: () => `tok-${tokens++}`,
      reconnectGraceMs,
    },
  );
  room.join("ana");
  room.join("ben");
  return { room, clock };
}

function started(...args: Parameters<typeof newRoom>): { room: Room; clock: FakeClock } {
  const made = newRoom(...args);
  expect(made.room.start(0).ok).toBe(true);
  return made;
}

/** The seat on turn plays a legal draw, so the clock sees a real action. */
function draw(room: Room): void {
  const seat = room.gameState!.currentSeat;
  expect(room.submitAction(seat, { type: "draw" }).ok).toBe(true);
}

function discardSomething(room: Room): void {
  const state = room.gameState!;
  const seat = state.currentSeat;
  const player = state.players[seat];
  const zone = player.inFoot ? player.foot : player.hand;
  expect(room.submitAction(seat, { type: "discard", cardId: zone[0].id }).ok).toBe(true);
}

describe("the turn clock", () => {
  it("starts a turn on the base clock", () => {
    const { room } = started();
    expect(room.clockState().deadlineAt).toBe(T0 + baseMs);
    expect(room.clockState().inDiscardGrace).toBe(false);
  });

  it("earns an increment for each action taken within the turn", () => {
    const { room } = started();
    draw(room);
    expect(room.clockState().deadlineAt).toBe(T0 + baseMs + incrementMs);
  });

  it("never lets the increment push a turn past the cap", () => {
    // The reason farming the increment needs no policing: the cap is absolute.
    const { room, clock } = started({
      // A tiny base and a huge increment make the cap the only thing holding.
      timers: { baseMs: 1_000, incrementMs: 100_000, capMs: 5_000, discardGraceMs: 1_000 },
    });
    draw(room);
    expect(room.clockState().deadlineAt).toBe(T0 + 5_000);
    clock.advance(10);
    // Another action cannot buy more time either.
    const state = room.gameState!;
    const zone = state.players[0].hand;
    room.submitAction(0, { type: "discard", cardId: zone[0].id });
    expect(room.gameState!.currentSeat).toBe(1);
  });

  it("resets the clock for the next seat when the turn passes", () => {
    const { room, clock } = started();
    clock.advance(20_000);
    draw(room);
    discardSomething(room);
    expect(room.gameState!.currentSeat).toBe(1);
    expect(room.clockState().deadlineAt).toBe(T0 + 20_000 + baseMs);
  });
});

describe("running out of time", () => {
  it("draws for the player and opens a discard-only grace on top of the cap", () => {
    const { room, clock } = started();
    expect(room.gameState!.phase).toBe("draw");

    clock.advance(baseMs);

    // Drawing is not a choice they still get to make, so the server does it and
    // leaves the discard — the part that matters — to them.
    expect(room.gameState!.phase).toBe("play");
    expect(room.log.entries().at(-1)).toMatchObject({ seat: 0, source: "timeout" });
    const state = room.clockState();
    expect(state.inDiscardGrace).toBe(true);
    expect(state.deadlineAt).toBe(T0 + baseMs + discardGraceMs);
    expect(room.gameState!.currentSeat).toBe(0);
  });

  it("lets the player still choose their own discard during the grace", () => {
    const { room, clock } = started();
    clock.advance(baseMs);
    const state = room.gameState!;
    const chosen = state.players[0].hand.at(-1)!;

    expect(room.submitAction(0, { type: "discard", cardId: chosen.id }).ok).toBe(true);
    expect(room.gameState!.discard.at(-1)!.id).toBe(chosen.id);
    expect(room.log.entries().at(-1)!.source).toBe("player");
    expect(room.gameState!.currentSeat).toBe(1);
  });

  it("refuses anything but a discard during the grace", () => {
    // Melding here would extend a turn that has already run past its cap.
    const { room, clock } = started();
    clock.advance(baseMs);
    const refused = room.submitAction(0, { type: "playMelds", melds: [] });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toContain("out of time");
  });

  it("plays the discard itself once the grace is gone too", () => {
    const { room, clock } = started();
    clock.advance(baseMs);
    expect(room.gameState!.currentSeat).toBe(0);

    clock.advance(discardGraceMs);

    expect(room.gameState!.currentSeat).toBe(1);
    expect(room.gameState!.discard.length).toBeGreaterThan(0);
    const forced = room.log.entries().filter((e) => e.source === "timeout");
    expect(forced.map((e) => e.action.type)).toEqual(["draw", "discard"]);
    // The next seat gets a full clock of their own.
    expect(room.clockState().inDiscardGrace).toBe(false);
    expect(room.clockState().deadlineAt).toBe(T0 + baseMs + discardGraceMs + baseMs);
  });

  it("tells the table when the server moves for someone", () => {
    const { room, clock } = started();
    let notifications = 0;
    room.onChange = () => notifications++;
    clock.advance(baseMs);
    expect(notifications).toBe(1);
    clock.advance(discardGraceMs);
    expect(notifications).toBe(2);
  });
});

describe("pausing the clock", () => {
  it("gives back exactly the time the table stood still", () => {
    const { room, clock } = started();
    expect(room.clockState().deadlineAt).toBe(T0 + baseMs);

    clock.advance(10_000);
    room.setPaused(1, true);
    expect(room.clockState().deadlineAt).toBeNull();
    expect(room.clockState().paused).toBe(true);

    clock.advance(60_000);
    room.setPaused(1, false);
    // The 60s of pause cost the player on the clock nothing.
    expect(room.clockState().deadlineAt).toBe(T0 + 60_000 + baseMs);
  });

  it("does not time anyone out while the table is paused", () => {
    const { room, clock } = started();
    room.setPaused(0, true);
    clock.advance(baseMs * 10);
    expect(room.log.length).toBe(0);
    expect(room.gameState!.phase).toBe("draw");
  });

  it("shifts the discard grace too, so a pause mid-grace is not a trap", () => {
    const { room, clock } = started();
    clock.advance(baseMs);
    expect(room.clockState().inDiscardGrace).toBe(true);
    expect(room.clockState().deadlineAt).toBe(T0 + baseMs + discardGraceMs);

    room.setPaused(1, true);
    clock.advance(discardGraceMs * 3);
    room.setPaused(1, false);

    // The grace deadline itself has to move. Asserting only "still their turn"
    // would not notice a grace left in the past: the timer that fires on it is
    // scheduled, not immediate, so the seat looks fine until the clock advances.
    expect(room.clockState().deadlineAt).toBe(T0 + baseMs + discardGraceMs * 3 + discardGraceMs);
    expect(room.clockState().inDiscardGrace).toBe(true);

    // A full fresh grace is genuinely available, and it still ends on time.
    clock.advance(discardGraceMs - 1);
    expect(room.gameState!.currentSeat).toBe(0);
    clock.advance(1);
    expect(room.gameState!.currentSeat).toBe(1);
  });

  it("lets the player on the clock pause their own turn indefinitely", () => {
    // The soft-cap consequence of unrestricted family-mode pause, pinned so it
    // is a known trade rather than a surprise.
    const { room, clock } = started();
    room.setPaused(0, true);
    clock.advance(capMs * 5);
    expect(room.gameState!.currentSeat).toBe(0);
    expect(room.log.length).toBe(0);
  });

  it("keeps the cap hard when pausing is off", () => {
    const { room, clock } = started({ mode: "competitive", pauseEnabled: false });
    expect(room.setPaused(0, true).ok).toBe(false);
    clock.advance(baseMs + discardGraceMs);
    expect(room.gameState!.currentSeat).toBe(1);
  });
});

describe("disconnection", () => {
  it("keeps a normal clock for a player who drops and comes straight back", () => {
    const { room, clock } = started({}, new FakeClock(T0), 30_000);
    room.setConnected(0, false);
    clock.advance(5_000);
    room.setConnected(0, true);
    clock.advance(5_000);
    // Well inside the reconnect grace, so nothing was played for them.
    expect(room.log.length).toBe(0);
    expect(room.gameState!.currentSeat).toBe(0);
  });

  it("plays the turn immediately once a player is gone past the grace", () => {
    const { room, clock } = started({}, new FakeClock(T0), 30_000);
    room.setConnected(0, false);
    // Their own clock still runs while they might come back.
    clock.advance(29_000);
    expect(room.gameState!.currentSeat).toBe(0);

    clock.advance(2_000);
    // Past the grace: the turn is played out rather than waited on.
    expect(room.gameState!.currentSeat).toBe(1);
    expect(room.log.entries().every((e) => e.source === "disconnect")).toBe(true);
  });

  it("does not burn a full clock on every later turn of an absent player", () => {
    // The playability point: one dropout must not make a table crawl.
    const { room, clock } = started({}, new FakeClock(T0), 1_000);
    room.setConnected(0, false);
    clock.advance(1_000);
    expect(room.gameState!.currentSeat).toBe(1);

    // Seat 1 plays normally, handing the turn back to the absent seat.
    draw(room);
    discardSomething(room);
    expect(room.gameState!.currentSeat).toBe(0);

    // No advance at all: the absent seat is played out on the spot.
    clock.advance(0);
    expect(room.gameState!.currentSeat).toBe(1);
  });

  it("freezes the reconnect grace while the table is paused", () => {
    // A family table often pauses precisely to wait for whoever dropped, so the
    // grace must not run out behind the pause and forfeit their turns on resume.
    const grace = 30_000;
    const { room, clock } = started({}, new FakeClock(T0), grace);
    room.setConnected(0, false);
    clock.advance(10_000);
    room.setPaused(1, true);
    clock.advance(grace * 10);
    room.setPaused(1, false);

    // The drop moves by exactly the pause, so the 20s left when the table paused
    // are what remain now — no more and no less.
    const since = room.seats()[0].disconnectedAt!;
    expect(since).toBe(T0 + grace * 10);
    expect(since).toBeLessThanOrEqual(clock.now());
    expect(since + grace - clock.now()).toBe(grace - 10_000);

    clock.advance(grace - 10_000 - 1);
    expect(room.gameState!.currentSeat).toBe(0);
    expect(room.log.length).toBe(0);
    clock.advance(1);
    expect(room.gameState!.currentSeat).toBe(1);
    expect(room.log.entries().every((e) => e.source === "disconnect")).toBe(true);
  });

  it("starts the grace of a player who dropped mid-pause at the resume, not later", () => {
    // Only the overlap with the pause is frozen. Crediting the whole pause would
    // put the drop in the future: extra grace, and a room that reaps late.
    const grace = 30_000;
    const { room, clock } = started({}, new FakeClock(T0), grace);
    room.setPaused(1, true);
    clock.advance(50_000);
    room.setConnected(0, false);
    clock.advance(20_000);
    room.setPaused(1, false);

    const resumedAt = T0 + 70_000;
    expect(clock.now()).toBe(resumedAt);
    expect(room.seats()[0].disconnectedAt).toBe(resumedAt);

    room.setConnected(1, false);
    expect(room.abandonedSince).toBe(resumedAt);
    room.setConnected(1, true);

    clock.advance(grace - 1);
    expect(room.gameState!.currentSeat).toBe(0);
    expect(room.log.length).toBe(0);
    clock.advance(1);
    expect(room.gameState!.currentSeat).toBe(1);
    expect(room.log.entries().every((e) => e.source === "disconnect")).toBe(true);
  });

  it("leaves a connected player's reconnect state alone across a pause", () => {
    const { room, clock } = started({}, new FakeClock(T0), 1_000);
    room.setPaused(1, true);
    clock.advance(5_000);
    room.setPaused(1, false);
    room.setConnected(0, false);
    room.setConnected(1, false);
    expect(room.abandonedSince).toBe(T0 + 5_000);
  });

  it("hands the clock back the moment an absent player returns", () => {
    const { room, clock } = started({}, new FakeClock(T0), 1_000);
    room.setConnected(0, false);
    clock.advance(1_000);
    const forcedTurns = room.log.length;

    room.setConnected(0, true);
    draw(room);
    discardSomething(room);
    expect(room.gameState!.currentSeat).toBe(0);
    clock.advance(10);
    // Back in control: nothing further was forced.
    expect(
      room.log
        .entries()
        .slice(forcedTurns)
        .every((e) => e.source === "player"),
    ).toBe(true);
  });
});

describe("clock lifecycle", () => {
  it("leaves no timer armed when a player's own move ends the round", () => {
    // The timer path already clears itself on the way through, so only a round
    // ended by a real submitted action can catch a missing teardown here.
    const { room, clock } = started({ extraDecks: 0, stockExhaustion: "end" });
    let guard = 0;
    while (!room.gameState!.roundEnded && guard++ < 2_000) {
      const state = room.gameState!;
      const action = defaultAction(state);
      expect(action).not.toBeNull();
      expect(room.submitAction(state.currentSeat, action!, "player").ok).toBe(true);
    }
    expect(room.gameState!.roundEnded).toBe(true);
    expect(room.log.entries().every((e) => e.source === "player")).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });

  it("leaves no timer armed once the round ends", () => {
    const { room, clock } = started({ extraDecks: 0, stockExhaustion: "end" });
    let guard = 0;
    while (!room.gameState!.roundEnded && guard++ < 1_000) {
      clock.advance(baseMs + discardGraceMs);
    }
    expect(room.gameState!.roundEnded).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });

  it("goes quiet rather than spinning when every seat has dropped", () => {
    // Each absent seat re-arms at zero delay, and the default policy never ends
    // a round, so forcing turns for an empty table is an unbounded hot loop —
    // in production it would burn a core until the room was reaped.
    const { room, clock } = started({}, new FakeClock(T0), 1_000);
    room.setConnected(0, false);
    room.setConnected(1, false);
    clock.advance(2_000);

    const afterFirstSweepPast = room.log.length;
    clock.advance(capMs * 10);
    expect(room.log.length).toBe(afterFirstSweepPast);
    expect(clock.pendingCount()).toBe(0);
    expect(room.abandoned).toBe(true);
  });

  it("picks the clock back up when someone returns to an abandoned table", () => {
    const { room, clock } = started({}, new FakeClock(T0), 1_000);
    room.setConnected(0, false);
    room.setConnected(1, false);
    clock.advance(2_000);
    expect(clock.pendingCount()).toBe(0);

    room.setConnected(1, true);
    // Seat 0 is still gone and now past its grace, so its turn is played out
    // and the table moves to the player who came back.
    clock.advance(0);
    expect(room.gameState!.currentSeat).toBe(1);
    expect(clock.pendingCount()).toBe(1);
  });

  it("stops the clock when the room is disposed", () => {
    const { room, clock } = started();
    expect(clock.pendingCount()).toBe(1);
    room.dispose();
    expect(clock.pendingCount()).toBe(0);
    clock.advance(capMs * 2);
    expect(room.log.length).toBe(0);
  });

  it("reports a room as abandoned only once every seat has dropped", () => {
    const { room, clock } = started();
    expect(room.abandoned).toBe(false);
    expect(room.abandonedSince).toBeNull();

    room.setConnected(0, false);
    expect(room.abandoned).toBe(false);

    clock.advance(500);
    room.setConnected(1, false);
    expect(room.abandoned).toBe(true);
    // Measured from the last person to leave, not the first.
    expect(room.abandonedSince).toBe(T0 + 500);
  });

  it("treats a room nobody ever joined as abandoned from when it opened", () => {
    const clock = new FakeClock(T0);
    const room = new Room("EMPTY1", EAST_COAST, {
      clock,
      seed: 1,
      newToken: () => "t",
    });
    expect(room.abandonedSince).toBe(T0);
  });
});
