# Hand and Foot

An online, real-time, multiplayer implementation of Hand and Foot, a family card game.

## Overview

I designed and implemented this project end to end: a custom rules engine, an authoritative
real-time server, a web client, and a deployment pipeline. The game platform is the foundation for
the project's primary technical objective, which is a reinforcement-learning agent, trained by
self-play, that plays the game more effectively than human opponents.

This document records the architecture, the design decisions and their trade-offs, the testing and
deployment approach, and the direction for the agent.

## Motivation

I learned Hand and Foot when I was three years old, before I was old enough to hold all 14 cards in
my hands. I have played it with my extended family ever since, and it remains the thing we consistently
do together whenever we see each other. My family is spread across the country, so those
occasions are rare, and I wanted a polished online version so that we could keep playing when we are
apart.

The game is also a deliberate choice of problem. It is a game of imperfect information (each
player's hand, foot, and the deck order are hidden), it is multiplayer and not strictly zero-sum
(two to eight players, with no fixed opponent), and it has a large, structured action space with
rewards that are realized only at the end of a round. These properties make it a demanding
environment for a learning agent, and they are the reason I built the game as a reusable platform
rather than a one-off application.

I built it to the standard I would apply to a feature or service at work, in order to demonstrate
that I can own a project end to end, from technical design through deployment.

## Architecture

```
                         +------------------------------------------+
   React client          |  Home > Create/Join > Lobby > Table       |
   <<  PlayerView only <<  |  local staging, SVG cards, timers/overlays|
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
   +----------+---------- action log ---------------------------------+
              v
        Postgres: append-only action log; replay to recover on restart
```

The system has three components joined by a single shared contract.

**Rules engine.** A pure, deterministic function of the form `(state, action) => newState`, with no
I/O and no networking. All game rules live here, which makes the core logic fully unit-testable in
isolation and allows the game to be simulated headlessly, a prerequisite for training an agent.

**Server.** Runs the authoritative engine for each room, validates incoming actions, projects a
filtered view for each player, broadcasts it, and owns room lifecycle, pacing, and reconnection.

**Client.** A React application that renders only the filtered `PlayerView` it receives and submits
validated actions. It never has access to another player's hidden cards.

**Shared types package.** The game state, actions, rule configuration, and the client/server
message contract are defined once in TypeScript and imported by both sides, so a change to the
contract surfaces as a compile error on whichever side is inconsistent.

## Design decisions

### Custom rules engine rather than a game framework

Frameworks such as boardgame.io and Colyseus provide turn and phase management and
hidden-information views, and are the fastest route to a playable game. I chose to implement the
engine directly. The two central concerns, turn and phase state and leak-free synchronization of
hidden information, are exactly what such a framework abstracts away, and implementing them was
consistent with the goal of owning the system end to end. The cost is additional code. The benefit
is full control over the engine, which the agent later depends on for deterministic, headless
simulation.

### Deterministic reducer with an append-only action log

The engine is a pure reducer, and shuffling draws from a seeded, injected random source rather than
a global generator, so any game is exactly reproducible from its seed and its sequence of actions.
The server maintains the live game state on the hot path and, alongside it, an append-only log of
every accepted action. The log is inexpensive, because actions are already serialized for transport,
and it supports several capabilities at once: replaying a game to reproduce a defect, capturing
reference games as regression tests, low-cost durable persistence, and a corpus of recorded games
for the agent.

### Authoritative server with per-player view filtering

The server never trusts client-submitted state, only validated actions. Before broadcasting, it
projects a separate `PlayerView` for each player in which every hidden zone (other players' hands,
all feet, and the deck order) is reduced to a count rather than a list of cards. The seed and deck
order never leave the server. This is the anti-cheat mechanism, and it is enforced by tests that
assert a view sent to one player cannot contain another player's hidden cards. The same projection
defines the observation available to the agent, which by construction cannot see more than a human
player can.

### Phase-grained actions with client-side staging

A turn is represented as a short sequence of atomic, server-validated actions (draw, play melds,
discard) rather than a single whole-turn submission or a per-card stream. Only draw and play melds
correspond to a game phase; the discard ends the play phase rather than being one, and a player who
has shed every card ends the turn without it. The rules require this action-grained shape regardless:
the per-round minimum must be validated across an entire lay-down at once, and a drawn card is
concealed until the server reveals it, so a turn cannot be planned in advance in a single message.
The client stages a player's melds locally, with a running total against the minimum, and submits
only committed actions. This keeps the server the sole authority while the interface remains
responsive.

### Legality decided once, on the server

The interface has to know which moves are available in order to be usable: an enabled button that the
server then refuses is a worse experience than one that was never offered. The obvious way to supply
that is to work it out in the client from the state it already has, and it does not work here. Whether
a player may take the discard pile is decided by a solver that reads the whole game state, and whether
they may go out depends on their books and the rest of the round; a client holds only its own filtered
view, by design. Answering those questions client-side would mean a second implementation of the rules
living in the interface, free to disagree with the reducer — and the version that disagrees is the one
the player sees.

So the server, which already holds the authoritative state and already computes these predicates for
its own validation, sends the answer alongside each filtered view. There is one implementation of
legality and the interface renders it. This discloses nothing: the summary is a handful of booleans, a
seat number and a list of ranks, every one of them a fact about the receiving player's own cards and
the face-up discard pile — what a human at the table can see. The subtle failure is computing the
summary for the wrong seat, which would both mislead that player and tell them something about another
hand, so it is asserted per seat both in isolation and across the transport.

The client still owns one derived quantity, because only it can: the offset between its clock and the
server's. Deadlines cross the wire as absolute server times rather than as a remaining duration, since
a duration is already stale when it is sent and would drift further on every update. The client
measures the difference once and reads deadlines through it, re-measuring only when the estimate is
provably wrong rather than on every message, which would make a countdown stutter with the network.

### Individual scoring rather than partnerships

Hand and Foot is often played in partnerships, where partners build shared books and going out is a
team condition. This implementation scores every player individually, which is how the game is
played in the family this was built for. The choice is structural rather than cosmetic: melds belong
to a `PlayerState`, and the take-pile solver, the lay-down minimum, the go-out check and round
scoring all read melds from the player taking the action. Partnership play would move melds to a
team and change each of those, so it is a deliberate decision recorded here rather than an
assumption to be discovered later.

### Rules chosen when a room is opened

A table's rules are settled before anyone sits down, so the creator picks them at room creation and
they do not change mid-game. The choice is a small set of named options — which preset, and family
versus competitive — rather than an arbitrary partial rules object. Every option is a union, so
anything that arrives over the wire is valid by construction and there is no validator to get wrong,
and the mode carries pausing with it because a competitive table is precisely one where the clock
cannot be stopped. Exposing the full rules surface belongs with the configurable rules editor
(roadmap item 2), which can present and validate it properly.

### Transport

I used Socket.io for the transport layer. It provides rooms, acknowledgement callbacks (which map
directly onto the submit-and-accept-or-reject action pattern), automatic reconnection, and liveness
detection. These are well-understood concerns that did not warrant a custom implementation, and
building them by hand would not have contributed to the parts of the system I set out to
demonstrate.

### Pacing and disconnection

The turn, not the phase, is the unit of time. A turn starts with a base clock and earns a
chess-clock increment for each action taken, so active play is not penalized while stalling is, but
a hard per-turn cap bounds the total no matter how much increment is accrued. The cap is what
actually solves the problem the clock exists for — an unbounded turn — and it has the useful side
effect of making the increment impossible to farm, so it needs no policing of its own. When the
clock expires before a discard, a short discard-only grace opens on top of the cap: melding is
closed, but the player still chooses their own card rather than having one chosen for them.

A Family mode permits any player to pause, including the player currently on the clock; a
Competitive mode disables pausing. This makes the cap a hard ceiling in Competitive play and a soft
one at a family table, which is the intended trade rather than an oversight.

Disconnections use the same mechanism: a disconnected player times out and the server plays a safe
default move on their behalf. That default is a pure function in the engine, so a forced move
replays exactly like a chosen one. It is deliberately conservative — it draws, settles a take-pile
obligation if one is open, and otherwise discards by heuristic, but it never melds voluntarily,
because laying a player's cards down while they are away commits them to a position they never
chose. One consequence matters for the server: a table of nothing but defaults never ends a round,
so an abandoned room is reaped rather than left to finish. A heuristic strong enough to serve as the
agent's evaluation baseline is separate, later work that will share the discard heuristic.

Leaving on purpose is a separate `leaveRoom` request rather than a closed socket, because the tab
usually stays open and the connection outlives the player's interest in the table. Before the deal
the seat is removed and the seats behind it close up, since `deal` seats exactly as many players as
there are and a gap would be dealt a hand nobody holds; the first seat hosts, so a departing host
hands the table to the next in line with no extra bookkeeping. Closing the gap renumbers other
players, so the server keys each socket's seat by token rather than by number, answers a
`resumeSeat` with the seat it resolved, and tells any socket that moved its new number. After the
deal the player count is fixed, so the seat stays and is treated as a disconnect whose grace has
already run out: the server plays it at once instead of stalling the table for a player who has
said they are not coming back.

Pacing timers are part of the rule configuration, since they change how the game plays. The
reconnect grace and the abandoned-room threshold are not: they are operational settings on the
server, because how long to wait for a dropped socket is not a rule of Hand and Foot. That division
decides where each setting is configured. Rules are chosen by whoever opens the room; operational
settings are read from the process environment at startup, where the person deploying the server sets
them and no player can reach them.

Environment values are validated rather than coerced, which is the opposite of how the server treats
a room's options arriving over a socket. An untrusted payload is normalized to a safe default, since
refusing to seat a player over a malformed field would be the worse outcome. An environment variable
is set deliberately by whoever deploys the server, so silently substituting a default would leave
them believing they had configured something they had not; the process stops at boot with a message
naming the variable instead. Shutdown is the same concern from the other end: the server closes its
rooms on SIGTERM so that every turn clock is released, because a process torn down with timers still
armed is the same runaway that the abandoned-room reaper exists to prevent, with no reaper left
running to catch it.

A table where every seat has dropped is reaped rather than left running. That is not housekeeping:
the safe default never melds, so such a table never ends its round, and left alone it would keep
playing forever.

### Persistence

A single server process holds each room's game in memory, which is sufficient for the intended
scale but means a restart would otherwise drop in-progress games. Because the action log already
exists, persistence is inexpensive: the log is written to Postgres and replayed to reconstruct
active games on restart, rather than serializing the full game-state graph. The database is a
durability backstop, not a coordinator; authoritative state remains in the single process.

## Testing

The rules engine is the component where correctness matters most, and it receives the majority of
the test effort.

- Unit tests cover each rule in isolation: melds, wild-card ratios, the special threes, the foot
  transition, go-out conditions, per-round minimums, taking the discard pile, and scoring.
- Property-based tests assert invariants across large numbers of randomized game sequences, for
  example that cards are conserved and that any legal action applied to a legal state yields a legal
  state.
- Golden-game replay tests record a game as a seed and an action sequence and assert its exact final
  state and scores. A game that once exposed a defect becomes a permanent regression test.
- Integration tests drive multiple clients through a complete multiplayer game, exercising turn
  order, reconnection, disconnection, and pause and resume.
- View-security tests encode the anti-cheat guarantee so that it cannot regress unnoticed.

## Tooling, continuous integration, and deployment

- TypeScript across the stack, with a shared types package so the client and server contract is
  checked at compile time.
- A pnpm and Turborepo monorepo with four packages: shared types, engine, server, and client.
- React with Vite, Tailwind CSS, Zustand, and React Router on the client; a Node service running the
  authoritative engine on the server.
- Vitest and fast-check for tests, and ESLint and Prettier for consistency.
- GitHub Actions runs type-checking, linting, tests, and formatting checks on every push and pull
  request.
- The server is containerized and deployed to Fly.io as a single always-on instance; the client is
  built statically and served from Vercel; game state is persisted to a managed Postgres database
  (Neon).

## Reinforcement-learning agent (design in progress)

The project's primary technical objective is a reinforcement-learning agent that learns, through
self-play, to play Hand and Foot more effectively than human opponents. The setting is deliberately
difficult: imperfect information, a multiplayer and non-zero-sum structure with a variable number of
opponents, a large and partly compound action space, and sparse rewards that arrive only at the end
of a round. The platform described above was built to support this work. The engine simulates games
deterministically and headlessly, the per-player view defines the agent's observation (its
information set), and the action log provides a corpus of recorded games.

A full design of the agent will be documented here, covering the state and action representation,
the treatment of imperfect information, the self-play training regime, reward design, and the
evaluation methodology against random, heuristic, and human baselines.

## Roadmap

The reinforcement-learning agent is the primary planned work and is described above. The first
release of the platform is a single round played over a shareable room link. Additional platform
work, in order:

1. Multi-round matches with escalating minimums and cumulative scoring.
2. A configurable rules editor, since the engine is already fully config-driven.
3. An interactive tutorial that teaches the game through guided scenarios.
4. Support for large tables on mobile.
5. A competitive layer with accounts, matchmaking, and ranked play.
