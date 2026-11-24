/* global process, setTimeout, console, localStorage, document, innerWidth */
// Renders the real built client at phone size against a mocked table socket, so
// any game state can be looked at. Usage: node scene.mjs <out.png> [W] [H] [action]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const [out, W = "390", H = "844", action = "", mode = "mine"] = process.argv.slice(2);
const base = process.env.BASE ?? "http://localhost:8787";
const c = (rank, suit, n = 0) => ({ id: `${rank}-${suit}-${n}`, rank, suit });
const names = ["Jack", "Ana", "Ben", "Cyrus", "Dee", "Eleanor"];
const meld = (rank, cards) => ({ rank, cards });
const book = (rank, wild) =>
  meld(
    rank,
    [...Array(wild ? 5 : 7)]
      .map((_, i) => c(rank, ["hearts", "spades", "diamonds", "clubs"][i % 4], i))
      .concat(wild ? [c("2", "clubs", 9), c("JOKER", null, 9)] : []),
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
    c("JOKER", null),
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
if (process.env.BLACK_BOOK) {
  // In the foot with a book of black threes down, holding a red three and a black
  // one: only the black three may go on the book.
  view.inFoot = true;
  view.hand = [];
  view.foot = [
    c("3", "hearts", 50),
    c("3", "clubs", 51),
    c("9", "spades", 52),
    c("K", "hearts", 53),
  ];
  view.footCount = 4;
  view.melds = [
    meld(
      "3",
      [...Array(7)].map((_, i) => c("3", i % 2 ? "spades" : "clubs", 30 + i)),
    ),
    ...view.melds.slice(0, 2),
  ];
  view.playedThisTurn = [];
}
if (process.env.FOOT) {
  // In the foot, a book short of going out: a queen, a 9 and a 7 of melded ranks
  // or not, a wild and a red three, with four queens down.
  view.inFoot = true;
  view.hand = [];
  view.foot = [
    c("Q", "spades", 60),
    c("9", "hearts", 61),
    c("7", "clubs", 62),
    c("JOKER", null, 63),
    c("3", "hearts", 64),
  ];
  view.footCount = 5;
  view.melds = view.melds.slice(0, 3);
  view.playedThisTurn = [];
}
if (process.env.TWO_DISCARDS) view.discard = [c("3", "hearts", 40), c("3", "diamonds", 41)];
if (process.env.PILE) {
  const ranks = ["5", "9", "Q", "4", "8", "J", "6", "10", "A"];
  const suits = ["spades", "hearts", "clubs", "diamonds"];
  view.discard = Array.from({ length: Number(process.env.PILE) }, (_, i) =>
    c(ranks[i % ranks.length], suits[i % suits.length], 60 + i),
  );
}
if (process.env.BIG_OPP) {
  // An opponent with a table full of melds, as tall as a seat gets: clean and dirty
  // books, and open melds with a two, a joker, both, or no wild at all.
  const wilds = (i) =>
    [
      [],
      [c("2", "spades", 100 + i)],
      [],
      [c("JOKER", null, 100 + i)],
      [c("2", "hearts", 100 + i), c("JOKER", null, 110 + i)],
    ][i % 5];
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
            ...wilds(i),
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
// BOTS=1: Ben and Dee are computer players. LOBBY=1: the table has not been dealt.
if (process.env.BOTS) {
  room.players = room.players.map((p) =>
    p.seat === 2 || p.seat === 4
      ? {
          ...p,
          name: p.seat === 2 ? "Robo Rita" : "Robo Ray",
          connected: true,
          bot: true,
          botLevel: p.seat === 2 ? "standard" : "hard",
        }
      : p,
  );
}
if (process.env.LOBBY) room.started = false;
// LOBBY_GUEST=1: Ana hosts, so the viewer sees the waiting room as a guest.
if (process.env.LOBBY_GUEST) room.hostSeat = 1;
// LEFT=1: Ana left the match after round 1, so round 2 was dealt without her.
const departed = process.env.LEFT ? [{ seat: 1, afterRound: 1 }] : undefined;
if (departed) {
  view.opponents = view.opponents.filter((o) => o.seat !== 1);
  view.departed = departed;
  room.players = room.players.map((p) =>
    p.seat === 1 ? { ...p, connected: false, departed: true } : p,
  );
}
// WATCHING=1: the viewer watches the table without a seat (open /watch/HFDEMO).
if (process.env.WATCHING) {
  room.watching = 1;
  view.seat = -1;
  view.hand = [];
  view.foot = null;
  view.footCount = 0;
  view.melds = [];
  view.isDown = false;
  view.playedThisTurn = [];
  view.opponents = [
    {
      seat: 0,
      handCount: 15,
      footCount: 13,
      melds: view.opponents[0].melds,
      isDown: true,
      inFoot: false,
    },
    ...view.opponents,
  ];
}
// A table Ana paused; SAVED=1 has her save it for later too.
if (process.env.PAUSED || process.env.SAVED) {
  room.pausedBy = 1;
  room.closesAt = Date.now() + 25 * 60_000;
}
if (process.env.SAVED) {
  room.savedUntil = Date.now() + 7 * 24 * 60 * 60_000;
  room.closesAt = room.savedUntil;
  room.players = room.players.map((p) => ({ ...p, connected: p.seat < 3 }));
  if (process.env.SAVED_GUEST) room.hostSeat = 1;
}
const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: +W, height: +H },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  // Headless Linux Chromium has no colour emoji font, so emoji draw as boxes. With
  // EMOJI_FONT pointing at a Noto Color Emoji .ttf, the page gets it for emoji code
  // points only — installing it system-wide makes Chromium use it for digits too.
  if (process.env.EMOJI_FONT) {
    await page.route("**/__emoji.ttf", (route) => route.fulfill({ path: process.env.EMOJI_FONT }));
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        // Declared as a face of each of the page's own families too, limited to
        // emoji, since Chromium never falls back to a web font by name.
        style.textContent = ["Noto Color Emoji", "Inter", "Space Grotesk", "JetBrains Mono"]
          .map(
            (family) =>
              `@font-face{font-family:"${family}";src:url(/__emoji.ttf);font-weight:100 900;` +
              "unicode-range:U+1F000-1FAFF,U+2600-27BF,U+2B50,U+FE0F}",
          )
          .join("");
        document.head.append(style);
      });
    });
  }
  await page.routeWebSocket(/\/api\/rooms\/.*\/socket/, (ws) => {
    ws.onMessage((text) => {
      if (text === "ping") return ws.send("pong");
      const frame = JSON.parse(text);
      if (frame.event === "resumeSeat" || frame.event === "watchRoom") {
        ws.send(
          JSON.stringify({
            ack: frame.id,
            result: {
              ok: true,
              data: frame.event === "watchRoom" ? room : { roomId: "HFDEMO", seat: 0, token: "t" },
            },
          }),
        );
        const now = Date.now();
        ws.send(JSON.stringify({ event: "room", payload: room }));
        const mine = mode !== "theirs" && mode !== "oppdraw" && mode !== "grabby";
        const takeable = !!process.env.TAKEABLE;
        const pileWhy =
          process.env.PILE_WHY && !takeable
            ? "with the pile your best lay-down is worth 45, short of the 90 you need to get down"
            : null;
        const v = !mine
          ? { ...view, currentSeat: 1, phase: "draw", playedThisTurn: [] }
          : pileWhy || takeable
            ? { ...view, phase: "draw", playedThisTurn: [] }
            : view;
        const base = {
          view: v,
          room,
          clock:
            room.pausedBy === undefined
              ? { serverNow: now, deadlineAt: now + 71_000, inDiscardGrace: false, paused: false }
              : { serverNow: now, deadlineAt: null, inDiscardGrace: false, paused: true },
          hints: {
            seatToAct: mine ? 0 : 1,
            phase: mine ? "play" : "draw",
            canDraw: false,
            canTakePile: false,
            meldableRanks: ["K", "9", "Q", "5"],
            canGoOut: !!process.env.GO_OUT,
            ...(pileWhy ? { phase: "draw", canDraw: true, takePileWhy: pileWhy } : {}),
            ...(takeable ? { phase: "draw", canDraw: true, canTakePile: true } : {}),
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
        if (process.env.ROUND_OVER) {
          // Round 2 just ended: the scoreboard between rounds.
          const bd = {
            cleanBooks: 1,
            dirtyBooks: 1,
            bookBonus: 800,
            meldedCards: 120,
            goOutBonus: 0,
            heldCount: 0,
            heldPenalty: 0,
            redThreesHeld: 0,
          };
          // What each seat was left holding, face up, with breakdowns that add up to it
          // as the engine's would: Ben went out, Cyrus never reached his foot.
          const cost = (x) =>
            x.rank === "JOKER"
              ? 50
              : x.rank === "2"
                ? 20
                : x.rank === "A"
                  ? 15
                  : x.rank === "3"
                    ? x.suit === "hearts" || x.suit === "diamonds"
                      ? 500
                      : 5
                    : ["10", "J", "Q", "K"].includes(x.rank)
                      ? 10
                      : 5;
          const heldBy = [
            { hand: [c("7", "spades", 7), c("Q", "hearts", 7), c("4", "clubs", 7)], foot: [] },
            { hand: [c("K", "clubs", 7), c("3", "diamonds", 7), c("9", "hearts", 7)], foot: [] },
            { hand: [], foot: [] },
            {
              hand: [c("A", "spades", 7), c("8", "clubs", 7)],
              foot: [
                ...["5", "6", "J", "Q", "K", "9", "10", "4", "A", "2", "8", "7"].map((r, i) =>
                  c(r, ["spades", "hearts", "clubs", "diamonds"][i % 4], 8),
                ),
                c("JOKER", null, 8),
                c("3", "hearts", 8),
              ],
            },
            { hand: [c("6", "hearts", 7)], foot: [c("10", "spades", 7)] },
            { hand: [c("2", "spades", 7)], foot: [] },
          ];
          const held = names.map((_, seat) => ({
            seat,
            ...heldBy[seat],
            footUntouched: seat === 3,
          }));
          const scoreOf = (seat, b) => {
            const cards = [...held[seat].hand, ...held[seat].foot];
            const heldPenalty = -cards.reduce((n, x) => n + cost(x), 0);
            const full = {
              ...b,
              goOutBonus: seat === 2 ? 100 : 0,
              heldCount: cards.length,
              heldPenalty,
              redThreesHeld: cards.filter((x) => x.rank === "3" && cost(x) === 500).length,
            };
            return {
              seat,
              score: full.bookBonus + full.meldedCards + full.goOutBonus + heldPenalty,
              breakdown: full,
            };
          };
          ws.send(
            JSON.stringify({
              event: "roundEnded",
              payload: {
                held: departed ? held.filter((h) => h.seat !== 1) : held,
                scores: names.map((_, seat) =>
                  departed && seat === 1
                    ? {
                        seat,
                        score: 0,
                        breakdown: {
                          ...bd,
                          cleanBooks: 0,
                          dirtyBooks: 0,
                          bookBonus: 0,
                          meldedCards: 0,
                        },
                      }
                    : scoreOf(seat, { ...bd, meldedCards: 260 - seat * 30 }),
                ),
                wentOutSeat: 2,
                roundNumber: process.env.MATCH_OVER ? 4 : 2,
                totals: names.map((_, seat) => 1500 - seat * 200),
                matchOver: !!process.env.MATCH_OVER,
                ...(process.env.MATCH_OVER && process.env.KEPT ? { matchId: "m-hfdemo" } : {}),
                ...(process.env.MATCH_OVER
                  ? {
                      tallies: names.map((_, seat) => ({
                        pilesTaken: [6, 2, 9, 1, 3, 0][seat],
                        grabbyPants: [1, 0, 3, 0, 0, 0][seat],
                        marvaRules: [0, 1, 0, 0, 0, 0][seat],
                        wentOut: [2, 1, 1, 0, 0, 0][seat],
                        cleanBooks: [4, 2, 1, 3, 0, 1][seat],
                        dirtyBooks: [5, 3, 4, 2, 1, 2][seat],
                        redThreesEaten: [0, 0, 1, 3, 0, 1][seat],
                      })),
                    }
                  : {}),
                ...(departed ? { departed } : {}),
              },
            }),
          );
        }
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
        if (mode === "takepile") {
          // The viewer takes the whole pile: every card flies to the hand, and the
          // pile is left empty.
          later(700, {
            ...base,
            view: { ...view, hand: [...hand, ...view.discard], discard: [] },
            lastMove: { seq: 6, seat: 0, kind: "takePile", count: view.discard.length },
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
            redThreesHeld: 0,
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
        if (mode === "react") {
          const reactions = [
            { seq: 1, seat: 1, id: "nice" },
            { seq: 2, seat: 2, id: "laugh" },
            { seq: 3, seat: 0, id: "party" },
          ];
          for (const payload of reactions) {
            setTimeout(() => ws.send(JSON.stringify({ event: "reaction", payload })), 700);
          }
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
  if (process.env.KEPT) {
    // The finished match was kept: the viewer has an identity, and the replay the
    // final scoreboard opens is answered from REPLAY_JSON (a recorded `ReplayMatch`).
    await page.evaluate(
      (identity) => localStorage.setItem("hf.identity", JSON.stringify(identity)),
      { userId: "u".repeat(16), secret: "s".repeat(32) },
    );
    if (process.env.REPLAY_JSON) {
      const replay = JSON.parse(readFileSync(process.env.REPLAY_JSON, "utf8"));
      await page.route("**/api/users/match", (route) =>
        route.fulfill({ json: { ok: true, data: replay } }),
      );
    }
  }
  // The computer's side panel put away, as a player who hid it left it.
  if (process.env.HIDE_SCORES)
    await page.evaluate(() => localStorage.setItem("hf.hideScores", "1"));
  // The player's own melds folded to chips, as a player who collapsed them left them.
  if (process.env.COMPACT_MELDS)
    await page.evaluate(() => localStorage.setItem("hf.compactMelds", "1"));
  if (process.env.SAVED_LIST) {
    // Two games this device saved for later, for the home screen.
    const day = 24 * 60 * 60_000;
    await page.evaluate(
      (games) => localStorage.setItem("hf.savedGames", JSON.stringify(games)),
      [
        {
          roomId: "HFDEMO",
          seat: 0,
          token: "t",
          savedUntil: Date.now() + 6 * day,
          names: ["Jack", "Ana", "Ben", "Cyrus"],
          round: 2,
        },
        {
          roomId: "KQ7RTX",
          seat: 1,
          token: "u",
          savedUntil: Date.now() + 2 * day,
          names: ["Grandma", "Jack"],
          round: 4,
        },
      ],
    );
  }
  if (action === "history") {
    // History with a few recorded games, a seat still held at HFDEMO (above) and
    // one game saved for later.
    const day = 24 * 60 * 60_000;
    const now = Date.now();
    const players = (...rows) => rows.map(([name, total], seat) => ({ seat, name, total }));
    const recent = [
      {
        id: "m1",
        roomId: "AB2CD3",
        endedAt: now - 2 * day,
        rounds: 4,
        roundsPlayed: 4,
        finished: true,
        seat: 0,
        place: 1,
        won: true,
        preset: "east-coast",
        awards: ["clean"],
        players: players(["Jack", 14320], ["Kate", 12905], ["Mom", 9440], ["Dad", 8110]),
      },
      {
        id: "m2",
        roomId: "BC3DE4",
        endedAt: now - 6 * day,
        rounds: 4,
        roundsPlayed: 4,
        finished: true,
        seat: 1,
        place: 2,
        won: false,
        preset: "west-coast",
        awards: [],
        players: players(["Sam", 11200], ["Jack", 9870], ["Priya", 7650]),
      },
      {
        id: "m3",
        roomId: "CD4EF5",
        endedAt: now - 9 * day,
        rounds: 4,
        roundsPlayed: 2,
        finished: false,
        seat: 0,
        place: null,
        won: false,
        preset: "east-coast",
        awards: [],
        players: players(["Jack", 4180], ["Kate", 3990], ["Mom", 2700]),
      },
    ];
    // PEOPLE=1: more games with more people, enough for "More" in Played with.
    if (process.env.PEOPLE)
      recent.push(
        {
          ...recent[0],
          id: "m4",
          roomId: "DE5FG6",
          endedAt: now - 14 * day,
          awards: [],
          won: false,
          place: 3,
          players: players(["Jack", 7210], ["Kate", 10400], ["Grandma", 12400], ["Dad", 6050]),
        },
        {
          ...recent[0],
          id: "m5",
          roomId: "EF6GH7",
          endedAt: now - 20 * day,
          awards: [],
          players: players(
            ["Jack", 13050],
            ["Kate", 9010],
            ["Uncle Ray", 11880],
            ["Aunt May", 8800],
          ),
        },
      );
    const stats = {
      played: 42,
      wins: 26,
      unfinished: 1,
      averageScore: 3940,
      bestMatch: 14320,
      bestRound: 6210,
      roundsPlayed: 130,
      grabbyPants: 4,
      marvaRules: 2,
      wentOut: 9,
      cleanBooks: 31,
      dirtyBooks: 11,
      pilesTaken: 57,
      redThreesEaten: 12,
      awards: { grabby: 1, marva: 0, clean: 2, out: 1, pile: 1, "red-threes": 0 },
    };
    await page.route("**/api/users/matches", (route) =>
      route.fulfill({ json: { ok: true, data: { stats, recent } } }),
    );
    await page.evaluate(
      ([games, identity]) => {
        localStorage.setItem("hf.identity", JSON.stringify(identity));
        localStorage.setItem("hf.savedGames", JSON.stringify(games));
      },
      [
        [
          {
            roomId: "KQ7RTX",
            seat: 1,
            token: "u",
            savedUntil: now + 5 * day,
            names: ["Grandma", "Jack", "Kate"],
            round: 3,
          },
        ],
        { userId: "u".repeat(16), secret: "s".repeat(32) },
      ],
    );
    await page.goto(`${base}/history`);
  } else if (action === "profile" || action === "profile-report") {
    // Profile, signed in as "jack" (with its Report a bug sheet open, below, for
    // `profile-report`).
    await page.route("**/api/users", (route) =>
      route.fulfill({ json: { ok: true, data: { username: "jack" } } }),
    );
    await page.route("**/api/users/matches", (route) =>
      route.fulfill({ json: { ok: false, error: "none here" } }),
    );
    await page.evaluate(() => {
      localStorage.setItem(
        "hf.identity",
        JSON.stringify({ userId: "u7Kq2xWm9PzR4tLc", secret: "s".repeat(32) }),
      );
      localStorage.setItem("hf.account", "jack");
      localStorage.setItem("hf.name", "Jack");
    });
    await page.goto(`${base}/profile`);
  } else if (action !== "home")
    await page.goto(`${base}/${process.env.WATCHING ? "watch" : "room"}/HFDEMO`);
  else await page.goto(base);
  await page.waitForTimeout(800);
  if (action === "history" && process.env.FILTERS)
    await page.getByRole("group", { name: "Filter games" }).scrollIntoViewIfNeeded();
  if (action === "history" && process.env.MORE)
    await page.getByRole("button", { name: /^Everyone you have played with/ }).click();
  if (action === "history" && process.env.PERSON)
    await page
      .getByRole("group", { name: "Played with" })
      .getByRole("button", { name: new RegExp(`^${process.env.PERSON}`) })
      .click();
  if (action === "menu") await page.getByRole("button", { name: "Main menu" }).click();
  if (action === "report" || action === "profile-report") {
    // The bug report sheet, from the table's menu or from Profile, with a few
    // words written; `REPORT_SEND=1` sends it (answered by a mock) for the thanks.
    if (action === "report") await page.getByRole("button", { name: "Main menu" }).click();
    await page
      .getByRole("button", { name: /^Report a bug/ })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: /what went wrong/i })
      .fill("I took the pile with two queens and my hand did not get the cards.");
    if (process.env.REPORT_SEND) {
      await page.route("**/api/reports", (route) =>
        route.fulfill({ json: { ok: true, data: { id: 7 } } }),
      );
      await page.getByRole("button", { name: "Send report" }).click();
    }
    // The foot of the sheet (Send), where a phone has to scroll to.
    if (process.env.REPORT_SCROLL)
      await page.getByRole("dialog").evaluate((sheet) => sheet.scrollTo(0, sheet.scrollHeight));
  }
  if (action === "scores") await page.getByRole("button", { name: "Scores so far" }).click();
  const seatName = process.env.SEAT ?? "Cyrus";
  if (action === "expand")
    await page.getByRole("button", { name: new RegExp(`^Expand ${seatName}`) }).click();
  if (action === "picker") await page.getByRole("button", { name: "React" }).click();
  if (action === "rules") {
    // On a phone the rules are an item in the table's menu.
    const button = page.getByRole("button", { name: "How to play" });
    if (!(await button.isVisible())) await page.getByRole("button", { name: "Main menu" }).click();
    await button.click();
  }
  if (action === "watchbutton")
    await page.getByRole("button", { name: "Watch it back" }).scrollIntoViewIfNeeded();
  if (action === "watchback") {
    // Open the replay from the final scoreboard, and let it play a little way in.
    await page.getByRole("button", { name: "Watch it back" }).click();
    await page.getByRole("combobox", { name: "Watch" }).waitFor();
    await page.waitForTimeout(Number(process.env.PLAY_FOR ?? 4000));
  }
  if (action === "chip")
    await page.getByRole("button", { name: new RegExp(`^${seatName}`) }).click();
  if (action === "expandrows") {
    // Open the scoreboard rows of Cyrus (foot never reached) and Ana (a red three).
    const board = page.getByRole("dialog", { name: "Round result" });
    for (const who of ["Cyrus", "Ana"])
      await board
        .getByRole("listitem", { name: new RegExp(`^${who}:`) })
        .getByRole("button", { name: "Show cards" })
        .click();
  }
  if (action === "dragboard") {
    // Drag the scoreboard aside by its heading, as far left and up as it goes.
    const heading = page.getByRole("dialog", { name: "Round result" }).getByRole("heading").first();
    const box = await heading.boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 400, box.y - 600, { steps: 8 });
    await page.mouse.up();
  }
  if (action === "card")
    await page
      .getByRole("button", { name: new RegExp(process.env.CARD ?? "Ten of hearts", "i") })
      .first()
      .click({ position: { x: 8, y: 30 } });
  if (action === "hidescores")
    await page.getByRole("button", { name: /(Hide|Show) scores and moves/ }).click();
  if (action === "meld") {
    await page.getByRole("button", { name: /^Meld$/ }).click();
    await page.getByRole("button", { name: /Ten of hearts/i }).click({ position: { x: 8, y: 30 } });
    await page.getByRole("button", { name: /Ten of clubs/i }).click({ position: { x: 8, y: 30 } });
  }
  if (action === "wildbook") {
    // A wild aimed at a finished book: the dirty 9s, or the clean Ks with `BOOK=K`.
    await page.getByRole("button", { name: /^Meld$/ }).click();
    const rank = process.env.BOOK ?? "9";
    await page
      .getByRole("button", { name: new RegExp(`^Select .*book of ${rank}s,`) })
      .first()
      .click();
    await page.getByRole("button", { name: /Two of hearts/i }).click({ position: { x: 8, y: 30 } });
  }
  const waitText = {
    draw: "16 cards",
    discard: `Discard (${view.discard.length + 1})`,
    takepile: "Discard (0)",
    oppdraw: "took the pile",
    grabby: "is Grabby Pants",
    react: "Nice!",
  }[mode];
  if (waitText) {
    await page.getByText(waitText).first().waitFor();
    // Frames to capture, and (CLICK_AT) moments to click the middle of the window,
    // both in milliseconds after the change, in time order.
    const times = (name, fallback) =>
      (process.env[name] ?? fallback)
        .split(",")
        .filter(Boolean)
        .map((ms) => ({ ms: Number(ms), click: name === "CLICK_AT" }));
    const steps = [...times("FRAMES", "80,300,600"), ...times("CLICK_AT", "")].sort(
      (a, b) => a.ms - b.ms || Number(a.click) - Number(b.click),
    );
    let elapsed = 0;
    for (const { ms, click } of steps) {
      await page.waitForTimeout(ms - elapsed);
      elapsed = ms;
      if (click) {
        const size = page.viewportSize();
        await page.mouse.click(size.width / 2, size.height / 2);
      } else await page.screenshot({ path: out.replace(".png", `-${ms}.png`) });
    }
  } else {
    await page.waitForTimeout(Number(process.env.SHOT_AT ?? 300));
    await page.screenshot({ path: out, fullPage: !!process.env.FULL_PAGE });
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
