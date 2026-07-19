# Hand and Foot

An online, real-time, multiplayer implementation of Hand and Foot (a Canasta variant), built so my
family can keep playing our game together from anywhere.

This document is a walk through the design and the engineering decisions behind it. It is meant to
be read alongside the code.

## Why I built this

I learned Hand and Foot when I was three years old, before I was even big enough to hold all 14
cards in my hands. I have played it with my extended family ever since, and it is still the thing we
reliably do together every time we are all in the same place: it is how we connect across
generations, for hours at a time.

My family is now spread across the country, so those times are rare and getting rarer. I wanted a
polished online version of our exact house rules, good enough that my family would actually choose
to use it, so we could keep playing even when we are apart.

I also built it as a portfolio project, and I made deliberate engineering choices to match. Rather
than reach for a turn-based-game framework that would solve the hard parts for me, I built the rules
engine and the authoritative real-time sync by hand, because those are the parts I actually wanted
to demonstrate. The sections below explain the architecture and the reasoning behind the decisions
that shaped it.

## What makes this a real engineering problem

Two things push this well past a typical CRUD web app:

1. **Hidden-information, real-time multiplayer with an authoritative server.** Every player holds a
   private hand and a private "foot" (a second hand picked up later), and no client can be trusted
   with the full game state, because that would make cheating trivial. The server is the single
   source of truth. It validates every action and sends each player only their own filtered view of
   the game, with opponents' hidden cards reduced to counts.

2. **A genuinely complex, configurable rules engine.** Hand and Foot has wild cards, red and black
   threes with special handling, a "foot" transition, per-round minimums you must reach in a single
   turn to start melding, an all-or-nothing "take the entire discard pile" move that has to be
   validated as an atomic unit, and multiple go-out conditions. On top of that, my family plays a
   specific variant, and different branches of the family play slightly different rules, so the
   engine is not hardcoded to one ruleset: it is parameterized by a configuration object, with named
   presets and room-level customization.

Neither of these is hard to fake and easy to get right. They are the reasons the project exists in
the form it does.

## Architecture at a glance

```
                         +------------------------------------------+
   React client          |  Home > Create/Join > Lobby > Table       |
   << PlayerView only <<  |  local staging, SVG cards, timers/overlays|
        ^                 +------------------------------------------+
        | ViewUpdate (per-player filtered)      | actions over Socket.io
        |                                        v
   +----+------------------------------------------------------------+
   | Server (single authoritative process)                            |
   |  +---------------+   validate / apply  +-----------------------+  |
   |  | Game manager  |------------------->|  Rules engine (pure)  |  |
   |  |  per room     |<-------------------| (state,action)=>state |  |
   |  |  + pacing/    |   new state         +-----------------------+  |
   |  |  timers/pause |        |  project a per-player PlayerView       |
   |  +-------+-------+        |  append the action to the log          |
   |          | write-behind   v                                        |
   +----------+---------- action log --------------------------------- -+
              v
        Postgres: append-only action log; replay to recover on restart
```

The system is three parts held together by one shared contract:

- **Rules engine** — a pure, deterministic function of the form `(state, action) => newState`, with
  no I/O and no networking. All of the game's rules live here, which makes the hardest logic fully
  unit-testable in isolation.
- **Server** — runs the authoritative engine per room, validates incoming actions, projects a
  filtered view for each player, broadcasts it, and owns room lifecycle, pacing, and reconnection.
- **Client** — a React app that renders only the filtered `PlayerView` it receives and sends
  validated actions back. It never sees another player's hidden cards.
- **Shared types package** — the game state, actions, rule configuration, and the client/server
  message contract are all defined once in TypeScript and imported by both sides, so a change to the
  contract is a compile error on whichever side falls out of sync.

## Design decisions that mattered

### A custom rules engine instead of a game framework

Frameworks like boardgame.io and Colyseus exist precisely to handle turn/phase state and
hidden-information views for you, and they are the fastest path to a playable game. I chose not to
use one. The two hardest problems here (managing turn and phase state, and syncing hidden
information without leaking it) are exactly the parts a framework hides, and exactly the parts worth
building and showing. The cost is more code; the payoff is that the interesting engineering is mine,
not a dependency's.

### A deterministic pure reducer plus an append-only action log

The engine is a pure reducer, and the shuffle draws from a seeded, injected random source (never a
global `Math.random`), so a game is fully reproducible from its seed and its list of actions. The
server keeps the live game state as its hot path, and alongside it an append-only log of every
accepted action.

That log is nearly free (the actions already have to be serialized to travel over the wire) and it
pays for itself several times over: I can replay a real game to reproduce a rule bug, I capture
"golden" games as permanent regression tests, I get durable persistence cheaply (below), and I get
clean training data for the bot later.

### An authoritative server with per-player view filtering

The server never trusts client-submitted state, only validated actions. Before broadcasting, it
projects a separate `PlayerView` for each player in which every hidden zone (other players' hands,
everyone's foot contents, and the deck order) is replaced by a count rather than a card list. The
seed and deck order never leave the server. This is the core anti-cheat mechanism, and it is guarded
by tests that assert a view sent to one player can never contain another player's hidden cards.

### Phase-grained actions with client-side staging

A turn is a short sequence of atomic, server-validated actions (draw, play melds, discard) that
mirror the game's own phases, rather than one big "here is my whole turn" blob or a chatty
per-card stream. This was driven by the rules themselves: the per-round minimum has to be validated
across an entire lay-down at once, and a drawn card is hidden until the server reveals it, so the
turn cannot be pre-planned in one message. The client lets you arrange melds locally with instant
feedback (a running "points so far vs. the minimum" counter) and only sends a committed action to
the server, which keeps the interaction snappy while the server stays the sole authority.

### Socket.io for transport

The transport is the one place I deliberately did not build from scratch. Socket.io gives me rooms,
acknowledgement callbacks (a natural fit for the "submit an action, get accepted or rejected back"
pattern), automatic reconnection, and liveness detection, all of which I need and none of which is
the interesting part. The engineering I wanted to demonstrate lives above the socket layer, so
using a well-understood library here costs nothing and saves real plumbing.

### A configurable pacing system

Because the game is meant to feel like a polished consumer product, each stage of a turn is timed,
and the meld stage uses a chess-clock-style increment (every meld you submit adds a little time), so
genuinely active play never runs out while stalling does. A "Family" mode lets anyone pause at any
time (for the real-world interruptions family games have), while a "Competitive" mode removes
pausing entirely. Disconnections are handled by the same timer machinery: a player who drops simply
times out through the stages and the server auto-plays a safe move, using a small discard heuristic
that is also the first version of the bot's logic. All of the timers are part of the rule
configuration.

### Lightweight, durable persistence via the action log

A single server process holds each room's game in memory, which is plenty for the scale this needs,
but it means a restart or deploy would drop every in-progress game. Because I already have the
append-only action log, durability is cheap: the log is persisted to Postgres and replayed to
rebuild any active game on restart, rather than serializing and mapping the entire game-state object
graph. The database is a durability backstop, not a coordinator; the authoritative state stays in
the one process.

## Testing

The rules engine is where correctness matters most and where I invested the test effort, using a few
complementary techniques:

- **Unit tests** cover every rule in isolation: melds, the wild-card ratios, the special threes, the
  foot transition, the go-out conditions, the per-round minimums, take-the-pile, and scoring.
- **Property-based tests** assert invariants that must hold across thousands of randomized game
  sequences, for example that cards are conserved (never duplicated or lost) and that applying any
  legal action to a legal state always yields a legal state.
- **Golden-game replay tests** record a full game as a seed plus its action list and assert the
  exact final state and scores. A game that once exposed a bug becomes a permanent regression anchor.
- **Integration tests** drive several socket clients through a complete multiplayer game to exercise
  turn passing, reconnection, disconnect handling, and pause/resume.
- **View-security tests** encode the anti-cheat guarantee directly, so it cannot silently regress.

## Tech stack

- **TypeScript end-to-end**, with a shared types package so the client/server contract is checked at
  compile time.
- **Rules engine:** custom, pure, and dependency-free.
- **Transport:** Socket.io.
- **Frontend:** React with Vite, Tailwind CSS, Zustand for state, React Router, and SVG cards.
- **Backend:** a Node service running the authoritative engine, containerized for deployment.
- **Persistence:** Postgres, accessed with Drizzle, storing the action log.
- **Tooling:** a pnpm plus Turborepo monorepo (shared, engine, server, client), Vitest and
  fast-check for tests, and GitHub Actions running typecheck, lint, and tests on every push.

## Roadmap

The first release is a single round played over a shareable room link. From there, in order:

1. Multi-round matches with escalating minimums and cumulative scoring.
2. A full custom-rules editor, since the engine is already fully config-driven.
3. An interactive tutorial that teaches the game by playing through guided scenarios, because the
   ruleset is the single biggest barrier to new players.
4. Bots, working up to one that plays better than the average human.
5. Polished play for large tables on mobile.
6. A competitive layer: accounts, matchmaking, and ranked play.
