/* global process, setTimeout, console, localStorage, document, innerWidth */
// Renders the real built client at phone size against a mocked table socket, so
// any game state can be looked at. Usage: node scene.mjs <out.png> [W] [H] [action]
import { chromium } from "playwright";
const [out, W = "390", H = "844", action = "", mode = "mine"] = process.argv.slice(2);
const base = "http://localhost:8787";
const c = (rank, suit, n = 0) => ({ id: `${rank}-${suit}-${n}`, rank, suit });
const names = ["Jack", "Ana", "Ben", "Cyrus", "Dee", "Eleanor"];
const meld = (rank, cards) => ({ rank, cards });
const book = (rank, wild) =>
  meld(
    rank,
    [...Array(wild ? 5 : 7)]
      .map((_, i) => c(rank, ["hearts", "spades", "diamonds", "clubs"][i % 4], i))
      .concat(wild ? [c("2", "clubs", 9), c("JKR", null, 9)] : []),
  );
const view = {
  seat: 0,
  hand: [
    c("4", "hearts"),
    c("5", "spades"),
    c("6", "diamonds"),
    c("7", "clubs"),
    c("8", "hearts"),
    c("9", "spades"),
    c("10", "hearts"),
    c("10", "clubs"),
    c("J", "diamonds"),
    c("Q", "spades"),
    c("K", "hearts"),
    c("A", "clubs"),
    c("2", "hearts"),
    c("JKR", null),
    c("3", "clubs"),
  ],
  foot: null,
  footCount: 13,
  melds: [
    book("K", false),
    book("9", true),
    meld("Q", [c("Q", "hearts"), c("Q", "clubs"), c("Q", "diamonds"), c("2", "spades")]),
    meld("5", [c("5", "hearts"), c("5", "clubs"), c("5", "diamonds")]),
  ],
  isDown: true,
  inFoot: false,
  opponents: [
    {
      seat: 1,
      handCount: 6,
      footCount: 13,
      melds: [book("A", false), meld("7", [c("7", "h"), c("7", "s"), c("7", "d")])],
      isDown: true,
      inFoot: false,
    },
    { seat: 2, handCount: 11, footCount: 13, melds: [], isDown: false, inFoot: false },
    {
      seat: 3,
      handCount: 0,
      footCount: 4,
      melds: [book("J", true), book("8", false), book("6", true)],
      isDown: true,
      inFoot: true,
    },
    {
      seat: 4,
      handCount: 9,
      footCount: 13,
      melds: [meld("4", [c("4", "h"), c("4", "s"), c("4", "d")])],
      isDown: true,
      inFoot: false,
    },
    { seat: 5, handCount: 14, footCount: 13, melds: [], isDown: false, inFoot: false },
  ],
  discard: [c("3", "hearts"), c("7", "diamonds", 3), c("K", "spades", 5)],
  stockCount: 131,
  currentSeat: 0,
  phase: "play",
  roundNumber: 2,
  pickedUp: [],
  wentOutSeat: null,
  finalLapRemaining: null,
  scoresSoFar: [340, 120, 510, -80, 205, 0],
  playedThisTurn: ["5-hearts-0", "5-clubs-0", "5-diamonds-0"],
};
if (process.env.BIG_MELDS) {
  // Enough melds that the middle of the table has to scroll.
  view.melds = [
    ...view.melds,
    ...["A", "J", "10", "8", "7", "6", "4"].map((r) =>
      meld(r, [c(r, "hearts", 20), c(r, "clubs", 21), c(r, "spades", 22), c(r, "diamonds", 23)]),
    ),
  ];
}
if (process.env.TWO_DISCARDS) view.discard = [c("3", "hearts", 40), c("3", "diamonds", 41)];
if (process.env.BIG_OPP) {
  // An opponent with a table full of melds, as tall as a seat gets.
  view.opponents[0] = {
    ...view.opponents[0],
    melds: ["J", "Q", "4", "7", "A", "K", "9", "8", "5"].map((r, i) =>
      i % 3 === 2
        ? book(r, i % 2 === 0)
        : meld(r, [
            c(r, "hearts", 60 + i),
            c(r, "clubs", 70 + i),
            c(r, "spades", 80 + i),
            c(r, "diamonds", 90 + i),
          ]),
    ),
  };
}
const grabbyMe = process.env.GRABBY_ME ? { grabbyPants: { seat: 0, streak: 3 } } : {};
const room = {
  roomId: "HFDEMO",
  players: names.map((name, seat) => ({ seat, name, connected: seat !== 4 })),
  hostSeat: 0,
  ...grabbyMe,
  started: true,
  config: {
    rounds: 4,
    layDownMinimums: [60, 90, 120, 150],
    wildRatio: "naturals-exceed-wilds",
    marvaRule: false,
    goOutCleanBooks: 1,
    goOutDirtyBooks: 2,
    handSize: 14,
    footSize: 14,
    extraDecks: 1,
    initialDiscardFlip: true,
    stockExhaustion: "reshuffle",
    scoring: {
      joker: 50,
      two: 20,
      ace: 15,
      tenToKing: 10,
      fourToNine: 5,
      blackThree: 5,
      redThree: -500,
      cleanBookBonus: 500,
      dirtyBookBonus: 300,
      goOutBonus: 100,
    },
    mode: "family",
    pauseEnabled: true,
    timers: { baseMs: 90000, incrementMs: 10000, capMs: 180000, discardGraceMs: 20000 },
  },
  playAgain: [],
  nextRoundReady: [],
};
const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: +W, height: +H },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.routeWebSocket(/\/api\/rooms\/.*\/socket/, (ws) => {
    ws.onMessage((text) => {
      if (text === "ping") return ws.send("pong");
      const frame = JSON.parse(text);
      if (frame.event === "resumeSeat") {
        ws.send(
          JSON.stringify({
            ack: frame.id,
            result: { ok: true, data: { roomId: "HFDEMO", seat: 0, token: "t" } },
          }),
        );
        const now = Date.now();
        ws.send(JSON.stringify({ event: "room", payload: room }));
        const mine = mode !== "theirs" && mode !== "oppdraw" && mode !== "grabby";
        const v = mine ? view : { ...view, currentSeat: 1, phase: "draw", playedThisTurn: [] };
        const base = {
          view: v,
          room,
          clock: { serverNow: now, deadlineAt: now + 71_000, inDiscardGrace: false, paused: false },
          hints: {
            seatToAct: mine ? 0 : 1,
            phase: mine ? "play" : "draw",
            canDraw: false,
            canTakePile: false,
            meldableRanks: ["K", "9", "Q", "5"],
            canGoOut: false,
          },
        };
        ws.send(
          JSON.stringify({
            event: "view",
            payload: {
              ...base,
              lastMove: mine
                ? { seq: 5, seat: 0, kind: "draw", card: c("J", "diamonds") }
                : { seq: 5, seat: 3, kind: "draw" },
            },
          }),
        );
        const later = (ms, payload) =>
          setTimeout(() => ws.send(JSON.stringify({ event: "view", payload })), ms);
        const hand = view.hand;
        if (mode === "draw") {
          ws.send(
            JSON.stringify({
              event: "view",
              payload: {
                ...base,
                view: {
                  ...view,
                  phase: "draw",
                  hand: hand.filter((x) => x.id !== "J-diamonds-0"),
                  playedThisTurn: [],
                },
                hints: { ...base.hints, phase: "draw", canDraw: true },
                lastMove: { seq: 5, seat: 5, kind: "discard", card: c("K", "spades", 5) },
              },
            }),
          );
          later(700, {
            ...base,
            lastMove: { seq: 6, seat: 0, kind: "draw", card: c("J", "diamonds") },
          });
        }
        if (mode === "discard") {
          later(700, {
            ...base,
            view: {
              ...view,
              hand: hand.filter((x) => x.id !== "7-clubs-0"),
              discard: [...view.discard, c("7", "clubs")],
            },
            lastMove: { seq: 6, seat: 0, kind: "discard", card: c("7", "clubs") },
          });
        }
        if (mode === "stale") {
          // A finished round at one table, then a fresh deal (round 1) at another.
          const bd = {
            cleanBooks: 0,
            dirtyBooks: 0,
            bookBonus: 0,
            meldedCards: 0,
            goOutBonus: 0,
            heldCount: 0,
            heldPenalty: 0,
          };
          ws.send(
            JSON.stringify({
              event: "view",
              payload: {
                ...base,
                view: { ...view, roundNumber: 1, playedThisTurn: [] },
                room: { ...room, roomId: "OLD234" },
              },
            }),
          );
          ws.send(
            JSON.stringify({
              event: "roundEnded",
              payload: {
                scores: [0, 1, 2].map((seat) => ({
                  seat,
                  score: 1000 - seat * 300,
                  breakdown: bd,
                })),
                wentOutSeat: 2,
                roundNumber: 1,
                totals: [1000, 700, 400],
                matchOver: false,
              },
            }),
          );
          later(700, {
            ...base,
            view: {
              ...view,
              roundNumber: 1,
              melds: [],
              isDown: false,
              playedThisTurn: [],
              opponents: view.opponents.slice(0, 1),
              scoresSoFar: [0, 0],
            },
            room: { ...room, roomId: "NEW234", players: room.players.slice(0, 2) },
          });
        }
        if (mode === "grabby") {
          setTimeout(
            () =>
              ws.send(
                JSON.stringify({
                  event: "room",
                  payload: { ...room, grabbyPants: { seat: 1, streak: 3 } },
                }),
              ),
            700,
          );
        }
        if (mode === "oppdraw") {
          later(700, { ...base, lastMove: { seq: 6, seat: 1, kind: "takePile", count: 3 } });
        }
        if (!mine && mode === "theirs")
          setTimeout(
            () =>
              ws.send(
                JSON.stringify({
                  event: "view",
                  payload: {
                    ...base,
                    view: { ...v, discard: [...v.discard, c("Q", "hearts", 7)] },
                    lastMove: { seq: 6, seat: 1, kind: "discard", card: c("Q", "hearts", 7) },
                  },
                }),
              ),
            300,
          );
      } else ws.send(JSON.stringify({ ack: frame.id, result: { ok: true, data: undefined } }));
    });
  });
  await page.goto(base);
  await page.evaluate(() =>
    localStorage.setItem("hf.seat", JSON.stringify({ roomId: "HFDEMO", seat: 0, token: "t" })),
  );
  await page.goto(`${base}/room/HFDEMO`);
  await page.waitForTimeout(800);
  if (action === "collapse") await page.getByRole("button", { name: "Collapse players" }).click();
  if (action === "chip") await page.getByRole("button", { name: /^Cyrus/ }).click();
  if (action === "card")
    await page.getByRole("button", { name: /Ten of hearts/i }).click({ position: { x: 8, y: 30 } });
  if (action === "meld") {
    await page.getByRole("button", { name: /^Meld$/ }).click();
    await page.getByRole("button", { name: /Ten of hearts/i }).click({ position: { x: 8, y: 30 } });
    await page.getByRole("button", { name: /Ten of clubs/i }).click({ position: { x: 8, y: 30 } });
  }
  const waitText = {
    draw: "Your hand (15)",
    discard: "Discard (4)",
    oppdraw: "picked up the pile",
    grabby: "is Grabby Pants",
  }[mode];
  if (waitText) {
    await page.getByText(waitText).first().waitFor();
    let elapsed = 0;
    for (const ms of (process.env.FRAMES ?? "80,300,600").split(",").map(Number)) {
      await page.waitForTimeout(ms - elapsed);
      elapsed = ms;
      await page.screenshot({ path: out.replace(".png", `-${ms}.png`) });
    }
  } else {
    await page.waitForTimeout(Number(process.env.SHOT_AT ?? 300));
    await page.screenshot({ path: out });
  }
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: innerWidth,
      })),
    ),
  );
  await browser.close();
};
run();
