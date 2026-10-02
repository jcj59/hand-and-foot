import { describe, expect, it } from "vitest";
import {
  FLASH_MS,
  STEADY_PREFIX,
  TURN_TITLE,
  frameFor,
  notificationSpent,
  notifyState,
  shouldNotify,
  signalFor,
  type Watch,
} from "./attention";

const watch = (over: Partial<Watch> = {}): Watch => ({
  myTurn: true,
  away: true,
  reducedMotion: false,
  ...over,
});

describe("the tab's signal", () => {
  it("flashes on the player's turn while they are away", () => {
    expect(signalFor(watch())).toBe("flash");
  });

  it("holds still for a player who asked for reduced motion", () => {
    expect(signalFor(watch({ reducedMotion: true }))).toBe("steady");
  });

  it("is quiet when it is not the player's turn, or they are looking", () => {
    expect(signalFor(watch({ myTurn: false }))).toBe("none");
    expect(signalFor(watch({ away: false }))).toBe("none");
    expect(signalFor(watch({ away: false, reducedMotion: true }))).toBe("none");
    expect(signalFor(watch({ myTurn: false, reducedMotion: true }))).toBe("none");
  });
});

describe("the tab's frames", () => {
  it("shows the page as it is when there is no signal", () => {
    expect(frameFor("none", "Hand and Foot", 0)).toEqual({ title: "Hand and Foot", alert: false });
    expect(frameFor("none", "Hand and Foot", 1)).toEqual({ title: "Hand and Foot", alert: false });
  });

  it("marks the title and icon without moving for reduced motion, at every beat", () => {
    for (const beat of [0, 1, 2]) {
      expect(frameFor("steady", "Hand and Foot", beat)).toEqual({
        title: "• Your turn – Hand and Foot",
        alert: true,
      });
    }
  });

  it("starts a flash on the news, then alternates with the page's own title", () => {
    expect(frameFor("flash", "Hand and Foot", 0)).toEqual({ title: "Your turn!", alert: true });
    expect(frameFor("flash", "Hand and Foot", 1)).toEqual({ title: "Hand and Foot", alert: false });
    expect(frameFor("flash", "Hand and Foot", 2)).toEqual({ title: "Your turn!", alert: true });
    expect(frameFor("flash", "Hand and Foot", 7)).toEqual({ title: "Hand and Foot", alert: false });
  });

  it("pins the words and the rhythm as literals", () => {
    // Asserted against literals, not the constants, so changing one fails here.
    expect(TURN_TITLE).toBe("Your turn!");
    expect(STEADY_PREFIX).toBe("• Your turn – ");
    expect(FLASH_MS).toBe(1000);
  });
});

describe("turn notifications", () => {
  it("go up when the turn has just come to an away player who turned them on", () => {
    expect(shouldNotify(watch({ myTurn: false }), watch(), true)).toBe(true);
  });

  it("need the player to have turned them on", () => {
    expect(shouldNotify(watch({ myTurn: false }), watch(), false)).toBe(false);
  });

  it("are one per turn, not one per update", () => {
    expect(shouldNotify(watch(), watch(), true)).toBe(false);
    expect(shouldNotify(watch({ away: false }), watch(), true)).toBe(false);
  });

  it("are not raised for the turn the page opened on", () => {
    expect(shouldNotify(null, watch(), true)).toBe(false);
  });

  it("are not raised for a player at the table, nor when the turn is someone else's", () => {
    expect(shouldNotify(watch({ myTurn: false }), watch({ away: false }), true)).toBe(false);
    expect(shouldNotify(watch({ myTurn: false }), watch({ myTurn: false }), true)).toBe(false);
  });

  it("go up with reduced motion too: a notification does not move", () => {
    const before = watch({ myTurn: false, reducedMotion: true });
    expect(shouldNotify(before, watch({ reducedMotion: true }), true)).toBe(true);
  });

  it("are spent once the turn passes or the player comes back", () => {
    expect(notificationSpent(watch())).toBe(false);
    expect(notificationSpent(watch({ myTurn: false }))).toBe(true);
    expect(notificationSpent(watch({ away: false }))).toBe(true);
  });
});

describe("the notification toggle", () => {
  it("is absent where the browser has no notifications", () => {
    expect(notifyState("unsupported", true)).toBe("unsupported");
    expect(notifyState("unsupported", false)).toBe("unsupported");
  });

  it("says blocked once the browser has been told no, whatever the player chose", () => {
    expect(notifyState("denied", true)).toBe("blocked");
    expect(notifyState("denied", false)).toBe("blocked");
  });

  it("is on only with both the player's choice and the browser's permission", () => {
    expect(notifyState("granted", true)).toBe("on");
    expect(notifyState("granted", false)).toBe("off");
    expect(notifyState("default", true)).toBe("off");
    expect(notifyState("default", false)).toBe("off");
  });
});
