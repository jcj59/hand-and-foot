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
        | ViewUpdate (per-player filtered)      | HTTP to sit down, then
        |                                        v one WebSocket per table
   +----+------------------------------------------------------------+
   | Cloudflare Worker: serves the client, routes /api by table code   |
   +----+------------------------------------------------------------+
        |  one Durable Object per table code
   +----v------------------------------------------------------------+
   | Table (Room + TableChannel, shared with the Node server)          |
   |  +---------------+   validate / apply  +-----------------------+  |
   |  | Room: seats,  |------------------->|  Rules engine (pure)  |  |
   |  |  pacing,      |<-------------------| (state,action)=>state |  |
   |  |  timers/pause |   new state         +-----------------------+  |
   |  +-------+-------+        |  project a per-player PlayerView       |
   |          | write-through  v  append the action to the log          |
   +----------+---------- action log ---------------------------------+
              v
        the table's own storage: record + append-only log; replay to recover
```

The system has three components joined by a single shared contract.

**Rules engine.** A pure, deterministic function of the form `(state, action) => newState`, with no
I/O and no networking. All game rules live here, which makes the core logic fully unit-testable in
isolation and allows the game to be simulated headlessly, a prerequisite for training an agent.

**Server.** Runs the authoritative engine for each room, validates incoming actions, projects a
filtered view for each player, broadcasts it, and owns room lifecycle, pacing, and reconnection.
The table logic — `Room` for the game around the engine and `TableChannel` for a table's
connections — knows nothing about how it is hosted. In production each table is its own Cloudflare
Durable Object; the same code also runs in a single Node process, with Postgres, for local play and
for self-hosting.

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

A log reproduces a game only if everything that shaped the deal is recorded beside it, and the seat
that takes the first turn proved to be one such input. It used to be implied: seat 0, whoever opened
the table. Choosing it at random could not be done by deriving it from the seed inside the deal,
because every match already recorded assumes seat 0 whatever its seed, and would stop replaying. So
the seat is chosen from the seed when a match is dealt, which keeps the engine free of any outside
source of randomness, and is then stored with the room as a fact of its own; a record written before
it existed has none, and is read as seat 0. The rule this follows is that a new input to the deal is
recorded rather than recomputed, so changing how it is chosen never rewrites a game already played.

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
has shed every card ends the turn without it. The rules require this action-grained shape
regardless: the per-round minimum must be validated across an entire lay-down at once, and a drawn
card is concealed until the server reveals it, so a turn cannot be planned in advance in a single
message. The client stages a player's melds locally, with a running total against the minimum, and
submits only committed actions. This keeps the server the sole authority while the interface remains
responsive. The staged lay-down is also mirrored to the server as a draft, which is not checked
against the rules or logged as a move; its only use is that a player whose clock runs out, or whose
turn the server takes over after a disconnect, has the largest part of it the rules accept played
for them rather than lost.

Nothing played during a turn is final until the turn ends, as at a real table, where a player who
put a wild on the wrong meld picks it back up before discarding. The engine keeps the seat as it
was before the turn's first play (`GameState.turnBase`), and a `takeBack` action restores it: the
cards return to the hand, the melds are as they were, a go-down made this turn is undone, and a
take-pile obligation the plays had settled is owed again. The client then puts the same cards
straight back into the lay-down being built, so moving a wild is a correction rather than a rebuild.
Two things are never undone: the draw or pickup, and a foot picked up mid-turn by melding the hand
away — picking it up clears the base, because undoing past it would let a player replan with cards
they have now seen. Because it is an ordinary action, it is logged and replays like any other.

What a player just did is sent with every view (`ViewUpdate.lastMove`), so the table can announce
another player's discard or pickup instead of leaving players to notice a changed card. A drawn
card is included only in the drawer's own update; everyone else learns that a card was drawn, not
which, and that is pinned over the wire as well as in the projection.

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

### The Marva rule, and celebrating it

The Marva rule waives the round minimum for a lay-down that empties the hand: a player down to a
few cards may meld them all and go to the foot, whatever they are worth. It is played in both
presets. Since the rule only loosens what is legal, a table saved under the old setting replays its
log unchanged — and it keeps its own setting anyway, because a table's rules are stored with it.

The family celebrates the rule being used, so the table does too: a full-screen announcement,
confetti, a deep voice and an air horn on every screen. The one thing the celebration must not do
is guess. Whether the waiver was actually needed — the lay-down worth less than the minimum, not
merely one that happened to empty the hand — is decided in the engine by the same arithmetic the
reducer applied, and the answer travels with the move every seat is already sent. That makes it
public by construction (the meld is on the table for all to see), keeps it out of the client's
hands, and lets a replay show it at exactly the moment the live table did. The announcement itself
is a shared overlay that Grabby Pants also uses, so the awards and tutorial planned later have one
place to build on.

### Grabby Pants

Grabby Pants is the table's title for a player who takes the discard pile three times running, with
nobody else taking it in between. It started as a title for the match, which a longer streak was
needed to take away; in play that meant one early run of luck settled it for an hour. It now lasts a
round, and anyone else's three in a row takes it: the joke is about who is grabbing now, not a record
to beat. The title is a pure function of the action log, with the next-round action as the reset, so
nothing about it is stored and the live table, a restart and a replay always name the same holder.
That also made the rule change cheap: no saved game stopped replaying, because what changed was only
what the table says about a game, never the game. Statistics that count it count each earning of the
title, not who held it when a match ended.

### Identity without accounts

Stats, match history and remembered names all need to know that the player at today's table is
the one from last week, and none of that justifies passwords for a family game. So each browser
makes up an identity the first time it is needed — a random user id and a random secret, kept in
its own storage — and registers it with the server, which keeps only a hash of the secret.
Presenting both again proves it is the same browser. Clearing storage simply makes a new one, and
a short code moves an identity to another device; a real sign-in can be layered on later by
attaching an account to an existing identity rather than migrating anything.

An identity says who someone is, never what they may do. Sitting down with one records it against
the seat, but the seat token remains the only thing that lets a connection act at a table, and
credentials that do not check out still get a seat, just an anonymous one: a table is never
refused over who someone claims to be. The identity is not broadcast with the room, since nothing
a player sees needs it yet.

On Cloudflare each identity is a Durable Object of its own, addressed by its id. Nothing ever
reads across identities, so a single database would add a resource to create and bind without
answering any question an object per identity cannot; on the Node host the same records sit in
a table beside the rooms.

### Quick reactions

Players at a real table talk, and an online one is quiet without a way to say "nice" or "hurry
up". Reactions are a fixed set of emoji and short phrases, sent by id; free text would need
moderation and would turn the table into a chat window, and neither was wanted. They are
deliberately outside the game: the table relays one to everyone and forgets it, so nothing is
logged, stored or replayed, and a table that sleeps and wakes has nothing to restore. The server
limits each seat to a short burst and then one every couple of seconds, which the client's own
pause after sending keeps anyone from meeting by accident, and each device can mute other players'
reactions without affecting anyone else.

### Rules chosen when a room is opened

A table's rules are settled before anyone sits down, so the creator picks them at room creation and
they do not change mid-game. The engine was config-driven from the start; what the creator could
reach of it began as a small set of named options — which preset, and family versus competitive.
Every option was a union, so anything that arrived over the wire could be coerced to a known value
with no validator to get wrong. That was the right trade while the options were two switches, and
the wrong one once a family wanted shorter turns or a smaller foot.

The creator now starts from a preset and a mode and may change any rule the engine reads: the turn
clock, the minimum for each round and the number of rounds, the wild ratio, the Marva rule, the
books needed to go out, hand and foot size, extra decks, the first discard, what happens when the
stock runs out, every score, and whether the table may be paused. What travels is a partial
config — only the changes — and the server checks every field of it before a table exists. That
gives up "valid by construction" for a validator, which is a real cost: it is code that can be
wrong, and whatever it lets through is a game the engine has to play. So it is kept strict rather
than forgiving. Each value has a range wide enough for any house variant and narrow enough that a
table cannot be opened into one that never ends or never starts: no turn of a few seconds, no
minimum nobody could make, no deal larger than the decks. Values that are each in range but do not
make a game together are refused too — a minimum missing for one of the rounds, a turn whose ceiling
sits below where it starts, going out with no books at all, a competitive table that can be paused.
An unknown rule is refused rather than ignored, because a misspelt rule dropped in silence is a
table playing rules nobody chose, and only known fields are copied into the result, so nothing else
a request carries can reach the stored config. Every refusal names the rule in words a player can
act on.

The check lives in the shared package rather than the server, and the editor runs it on every
keystroke, so the reason a table would be refused is on screen before it is asked for. That is the
same argument as for legality hints: one implementation, asked in two places, cannot disagree with
itself. The server's answer is still the only one that counts, since a form is a convenience and
the endpoint takes whatever is posted to it.

The mode still carries pausing with it as a default — a competitive table is precisely one where
the clock cannot be stopped — and a family table may now turn pausing off, but a competitive one
may not turn it on. The resolved config records which preset it started from, so every player in
the lobby sees the table's rules with whatever was changed marked against the preset's own value;
a table stored before that was recorded is read by its wild ratio, which was all that ever told the
presets apart. The full config was already stored with each room, so a restored table replays
under exactly the rules it was opened with, and nothing about storage changed. The creator's last
choice is remembered on the device for now; it belongs with the player's identity and moves there
once identities carry settings.

### Transport

The first transport was Socket.io, which provides rooms, acknowledgement callbacks (a natural fit
for submit-then-accept-or-reject), reconnection and liveness detection. It was replaced when the
hosting moved to Cloudflare, because it assumes one server process holding every connection, and a
Durable Object per table is the opposite shape.

The replacement is small and keeps the same contract. Opening or joining a table is an HTTP
request, because there is not yet a table to hold a socket to. Once seated, a client holds one
plain WebSocket to that table, and each request is a JSON frame with an id that the reply echoes,
which is all an acknowledgement callback ever was. Server pushes are frames with an event name. The
client-side wrapper keeps Socket.io's surface — `emit` with a callback, `on`/`off`, `connect` and
`disconnect` events — so nothing above it changed; underneath it reconnects with back-off and moves
its socket when a player moves to another table. A dropped socket reconnects as a new connection
that holds no seat until it presents its token again, exactly as before.

Liveness is the client's job now, because a browser cannot send a WebSocket protocol ping. It sends
a plain-text `ping` every 25 seconds, which keeps Cloudflare from closing an idle socket (it does so
after roughly 100 seconds) and doubles as the client's own check: an interval with nothing heard
back means the connection is dead, however open the browser believes it is, and the client drops
and reopens it. The Node server additionally pings from its side, so that a seat whose client
vanished is marked empty promptly.

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
chose. (A lay-down the player had staged themselves is different: they did choose it, so it is
played before the default takes over.) One consequence matters for the server: a table of nothing
but defaults never ends a round, so an abandoned room is reaped rather than left to finish. The
heuristic that plays to win, and serves as the agent's evaluation baseline, is a separate function
that shares the default's discard judgement; see "A heuristic opponent" below.

Leaving on purpose is a separate `leaveRoom` request rather than a closed socket, because the tab
usually stays open and the connection outlives the player's interest in the table. Before the deal
the seat is removed and the seats behind it close up, since `deal` seats exactly as many players as
there are and a gap would be dealt a hand nobody holds. Whoever opens the table hosts it, and may
hand hosting to another player before the deal; the host is recorded by token rather than by seat,
so handing it on moves nobody, and a departing host passes it to whoever is then first in line.
Closing the gap renumbers other players, so the server keys each socket's seat by token rather than
by number, answers a `resumeSeat` with the seat it resolved, and tells any socket that moved its new
number. After the deal the player count is fixed, so the seat stays and is treated as a disconnect
whose grace has already run out: the server plays it at once instead of stalling the table for a
player who has said they are not coming back.

A dropped connection is recovered by the client rather than the transport. The transport reconnects
on its own, but to the server the result is a new socket carrying no seat, so the client presents
its seat token again on every reconnect, not only when the page loads. This matters more than it first
appears: every deploy of the server restarts it, which reconnects every open tab at once, and a tab
that did not reclaim its seat would show a live table whose every move is refused while the server,
seeing the seat empty, plays it on the player's behalf. The client distinguishes a refused reclaim,
which means the table is gone and sends the player home, from an unanswered one, which says only
that the network is poor and keeps the seat for the next attempt.

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

Whatever hosts a table holds its game in memory, which means a restart would otherwise drop
in-progress games — and every deploy is a restart. Because the action log already exists,
persistence is inexpensive: the log is written to storage and replayed to reconstruct active games
on restart, rather than serializing the full game-state graph. Storage is a durability backstop,
not a coordinator; authoritative state remains in memory with the table. The store is an interface
with two implementations: Postgres for the Node server, and a Durable Object's own storage.

The log cannot carry what happens around the game rather than in it — who is seated, who hosts,
whether the table has dealt, who paused it, who has said they are ready for the next round, who has
gone on to play again and where — so each room also keeps a small record of those, rewritten when
they change. Rooms are keyed in storage by an identifier of their own rather than by
their code, because six-character codes are short enough to come round again, and a new table must
never inherit an old one's history. Nothing is deleted: a room that is reaped is only marked closed,
since a finished game reproduces a defect exactly, can become a regression test, and is a training
example for the agent.

Writes are issued behind the game in the order they happened and are never awaited by it, so a slow
database costs recoverability rather than a player's turn. A write that fails is retried through a
short outage and then abandoned with a log line. An abandoned write leaves a gap, and restoring
checks for exactly that: a room whose record and log do not add up — a missing or misordered entry,
a move out of turn, a move the current engine refuses — is closed and reported rather than rebuilt,
because dealing players back into a game that differs from the one they left is worse than telling
them it is gone.

What a restart cannot restore is anything about time or connections. Every seat comes back
disconnected with its reconnect grace starting afresh, and the turn on the clock restarts, since
how much of it had been used died with the process. A paused table stays paused. Until a player
returns, a restored room is abandoned and runs no clock, so a restart never has the server playing
turns for tables nobody has come back to.

The Node server's deployment follows from holding rooms in one process. It runs as exactly one machine,
because a second would be a second, disjoint set of tables. Deploys stop the old process before
starting the new one: the old one hears SIGTERM, stops its clocks and writes out what it still owes
the database, and the new one restores every open room before it accepts a connection. Running the
two side by side, as a blue-green deploy would, would have both writing the same rooms.

Writing out what it owes is bounded in time. A host kills a process that has not exited within its
kill timeout (commonly 30 seconds), and a flush against a database that has stopped answering would
otherwise retry each write for most of a minute. So once shutdown begins, a failing write is not
retried, and the queue gets twenty seconds to drain; whatever remains is abandoned under a single
log line naming each write, and the process exits on its own. The cost of a database outage during
a deploy is therefore that the affected rooms come back a few moves behind or, where the gap falls
mid-log, are refused on restore — and that it is on record which ones, rather than lost to a kill
signal that says nothing.

### Hosting: a Durable Object per table

The game is played by one family, so the hosting had to cost nothing — not a few dollars a month,
nothing — while still being an always-on server that anyone can reach by link. An always-on
virtual machine fails the first requirement on every provider that does not eventually charge, and
a serverless function fails the second, because a table is a set of long-lived connections around
shared in-memory state with timers. Cloudflare's Durable Objects fit both: an object is a
single-threaded actor addressed by name, with its own storage, that can hold WebSockets, and the
free plan covers far more than this game uses.

Each table is one object, addressed by its code. That is a better fit than the single process it
replaced, not just a cheaper one. A table was always the unit of consistency — nothing in the game
reads across tables — and an object gives exactly that unit a home: its requests are serialized,
so there is no locking; its storage is transactional and local, so writes are synchronous and never
queued behind the game; and it cannot be run twice at once, which is the invariant the Node
deployment had to protect by hand. The one operation that crosses tables, moving players to the next
game, is a call from one object to another. Codes are drawn at random and an object refuses to open
a second table under a code it is already running, so a collision is retried rather than detected
by a registry.

The free plan bills an object for the time it spends in memory, and a table with players waiting
at it is mostly idle. So sockets are accepted through the hibernation API: when nothing is
happening, the runtime may evict the object from memory while its sockets stay open, and an
evicted object is not billed. The next message wakes it, and waking is a restart — the constructor
rebuilds the game from storage by replaying the log — followed by re-seating each still-open socket
from the seat token it carries in its own attachment, so its player notices nothing. The keep-alive
is answered by the runtime itself without waking the object. A running turn clock holds a timer,
which keeps the object awake, so a table actually in play stays resident; it can sleep between
rounds, while paused, and in the lobby. At about 450 GB-seconds per hour of play against a free
allowance of 13,000 a day, that is ample. Moving the turn clock onto the object's alarm would let it
sleep mid-round too, but only by persisting the clock's deadlines so that a wake does not restart
the turn — complexity with no saving that matters at this scale.

A table is closed by an alarm rather than by a sweep over every room, since there is no longer a
process that holds them all: whenever anything about the table changes it sets an alarm for when it
would close, and the alarm checks again when it fires.

### How long a table is kept

Closing a table only once everyone had disconnected turned out not to be enough, because a tab left
open counts as someone there: the client's keep-alive keeps it connected indefinitely. A table
paused one morning was still open that evening. So a table's lifetime is now decided by one rule,
`Room.closing`, which both hosts act on — the Node server's sweep and the Durable Object's alarm:

- A paused table is closed half an hour after it was paused, whoever is still connected. A pause is
  for a break; a tab left open on a paused table is not somebody playing.
- A family table can be saved for later, mid-turn or between rounds, which pauses it if it was not
  paused and keeps it for a week instead. It is not closed for being empty in the meantime, since
  everyone leaving is the point; see "Finishing a game another day" below.
- A table nobody is playing pauses itself, once a whole lap of turns has been played by the clock
  with nobody at the table moving; then the pause's half hour applies. Without this a forgotten,
  unpaused table would be played by the server forever, since the default policy never melds and so
  never ends a round — and on Cloudflare it would hold its object awake all the while. This applies
  to competitive tables too, where players cannot pause: nobody chose this pause, so anyone may
  resume it.
- Otherwise, as before, a table everyone has left is closed half an hour after the last one went.

When the pause began is saved with the table, so neither a restart nor a Durable Object waking gives
a paused table a fresh half hour. Players still at a table when it closes are told why and sent
home, rather than finding out on their next click.

### Finishing a game another day

A pause is for a break; a saved game is for a group that wants to stop tonight and finish the match
another evening. Three things make that different from leaving a paused table open.

Leaving a saved game does not give up the seat. After the deal, leaving normally marks a seat as
gone for good, so that the server plays it at once rather than stalling the table; for a saved game
that would have every player who went home played the moment it resumed. The seat is only left
empty, so a player who has not come back gets the ordinary reconnect grace from the resume.

Coming back leads to a waiting room rather than straight to the cards. Everyone at a saved table
sees who has returned, and the host picks the game back up once they are satisfied the table is
there — or anyone may, if the host is the one who has not come back, so that one absence cannot
hold the game. Until then nothing can be played, and nobody can be dealt the next round: whoever
said they were ready before the game was put away says so again after it resumes, having seen the
scores a second time.

The way back is kept on the device rather than in the seat the browser remembers. That seat is
replaced by whichever table the player sits at next, which in a week of other games is almost
certain, so each saved game keeps its own seat in a list the home screen shows apart from the
ordinary Rejoin. The list follows what the server says — a table is remembered while it is saved
and forgotten when it resumes or closes — and is never the authority on whether a game still
exists: the seat token is, and a refused one simply drops the entry. The list is per device; moving
a saved game to another device would mean finding a player's seats by their identity, which the
server already records with each seat but does not yet offer as a lookup.

### Watching a game back

Every later piece of work changes something a player sees, and most of the situations worth
checking — the Marva waiver, a black-three book going out, the stock running dry, a cardless player
taking the pile back — are ones a random deal will practically never produce. So the client has a
player that runs any game on the real table from the engine alone, with no server: play, pause,
step either way, scrub, change speed, watch any seat, and jump by turn, by round, or to a moment.

The player takes one input, whatever the game's origin: the rules, a starting position (a seed or
a state built by hand) and the actions applied to it. A scripted scenario, a golden game from the
tests and a match the server recorded all reduce to that, which is why replaying stored matches
later should need a new data source and nothing more. The engine turns the input into a timeline:
it replays the actions once to check them and records what the player needs — where each turn and
round begins and ends, and the moments worth stopping at, which are found in any game rather than
only in the ones someone annotated. Seeking costs little because the engine is a pure reducer: the
state at any step is the setup with that many actions folded over it, so the timeline keeps a state
every few dozen steps and replays forward from the nearest.

A watched step is rendered through the same projection a seat is sent, so the player shows a seat
exactly what it saw and nothing more; showing every hand is an extra panel drawn on top, not a
looser view. A move played forward is shown as a move, with its animation, sound and
announcement, while a jump lands silently, because nothing happened at the table — only the
position changed. For the same reason the facts the server used to derive on its own, such as who
holds Grabby Pants and what a move announced, moved into the engine as pure functions of the log,
so the live table and a replay cannot disagree about them.

Scenarios themselves are data in their own package: a table arranged from card shorthand, with
everything not named dealt from a real shoe so that every card exists exactly once, and a script of
intentions — "meld these kings", "discard the nine of clubs", "play on until the round ends" —
resolved into actions by playing it. Every scenario is replayed in continuous integration, so a
rules change that breaks one fails the build by name. The viewer is a development tool and is left
out of production builds; the player it uses is not tied to it.

### A heuristic opponent

The safe default above never melds, so it cannot serve as an opponent: it never scores and never
ends a round. The agent needs a baseline that plays to win, and a person playing alone will need
opponents, so the engine has a second policy beside the default, a hand-written heuristic. Its
moves are ordinary: it takes the pile when the rules allow and the pile is worth having, gets down
as soon as a lay-down reaches the minimum (or melds the whole hand under the Marva rule), lays every
natural it can once down, and goes out as soon as it holds the books.

It is given the seat's filtered view and the rules, never the game state. That is the same
observation a human has and the agent will have, so a comparison between them is fair, and it is
enforced by the type rather than by care: a function handed a view has no other hand, foot or stock
order to look at. A property test checks it anyway, by dealing every card the seat cannot see
differently and requiring the same move. The heuristic also reuses the engine's own pieces rather
than holding copies: the lay-down search that decides whether the pile may be taken is the one it
plays with, so it never takes a pile it cannot then settle, and its discards use the default's
judgement of which card is least useful. It does not randomize. The same view always gets the same
move, which keeps every game it plays replayable from its seed, and variety can come later from
the agent rather than from noise in the baseline.

Most of its judgement is about wild cards, which are scarce and decide books. It never puts a wild
on a clean book, nor on the clean meld closest to becoming one while a clean book is still needed
to go out. In the hand it spends a wild only to complete a book, because a natural pair and a wild
is how a player takes the pile; from the foot, when a held wild is only a penalty in waiting, it
spends them all. One exception was found by watching it fail: a seat that had built more clean books
than going out needs, and could no longer find the cards for a dirty one, drew and discarded threes
indefinitely. So a spare clean book is given a wild when a dirty book is missing, trading 200 points
of bonus for the ability to go out.

The choices were settled by measurement, not intuition. A small arena plays whole matches
headlessly with a policy per seat, and a script reports the heuristic's results against the
default, against itself, and whether rounds end. Variants were played head to head with seats
swapped: declining a pile with three or more red threes beat both a stricter and a looser limit,
and guarding the clean prospect was worth about ten points of win rate, while two ideas that
sounded right, spending wilds from the hand and avoiding discards an opponent's meld could use,
changed nothing measurable and were left out. Against the default it wins about 99% of two-player
matches and 87% at four seats; against copies of itself the seats split evenly, and all but a
handful of thousands of rounds end with someone going out.

That handful is a property of the rules rather than the heuristic. With the stock reshuffled from
the discards whenever it runs out, only going out ends a round, and a round can reach a position
where nobody can: every card that could finish a missing book is already melded or held for good.
Among heuristic players it is rare. Beside defaults, which hoard their wilds and pairs, it is
common enough to matter, since the stock drains to threes no one can meld. A bot standing in for
absent players would therefore end most abandoned rounds, but not all of them, so the reaper
stays.

### Calling a player back to the table

A family game is mostly waiting. Between turns a player reads something else in another tab, and
the turn chime is easy to miss: the sound may be muted, the browser may be holding it back until the
page is tapped, or the speakers may simply be off. So the tab itself says when the turn has come.
While it is the player's turn and the page is hidden or another window has focus, the title
alternates with "Your turn!" once a second and the favicon gains an amber mark; both are put back
the moment the turn passes or the player returns. A player who has asked their system for reduced
motion gets the same news standing still: the marked icon and a prefix on the title, with nothing
blinking. Whether it is the player's turn is not worked out a second time for this. It is the very
flag the chime is played from, so the tab and the table cannot disagree.

A browser notification can go up as well, but only for a player who has turned it on at the table.
The browser's permission is asked for from that tap and never on page load, because a prompt nobody
asked for is usually refused, and a refusal cannot be asked again; once refused, the button says so
and leaves the browser's settings to undo it. A notification is raised once per turn, never for the
turn the page opened on, never while the player is looking, and is closed when the turn passes or
they return, so the notification centre does not fill with stale turns. It is silent when the table
is muted. The button is not offered on phones: Chrome on Android refuses a notification made by a
page rather than a service worker, and iOS has notifications only through web push, so the button
would promise something that never arrives.

The game can also be installed as an app — a manifest, icons, and a theme colour — which on a phone
puts it on the home screen without the browser's chrome. It ships no service worker. Current
Chromium offers installation without one (checked directly: Chromium 141 raises its install prompt
for this manifest with no worker registered, and not for a broken one), and Safari's Add to Home
Screen never needed one. A worker would earn nothing for a game that cannot be played offline, and
it would be one more thing able to serve a stale page or come between the page and its socket. The
files are ordinary client assets, which the Worker serves as it serves the rest of the build; a
Worker test checks each icon the manifest names is a real file rather than the page the
single-page fallback would answer with. Telling a player it is their turn while the page is closed
would need web push and a service worker after all; that is left as a follow-up, to be taken up only
if it fits the free plan.

## Testing

The rules engine is the component where correctness matters most, and it receives the majority of
the test effort.

- Unit tests cover each rule in isolation: melds, wild-card ratios, the special threes, the foot
  transition, go-out conditions, per-round minimums, taking the discard pile, and scoring.
- Some positions are too rare for random games to reach. A black three on the pile in front of a
  player with six more in their foot — found in a real game, where the pile was wrongly refused — is
  one; so those positions are generated directly, and the guarantee that a pile the rules allow can
  always be settled is asserted over them as well as over random play.
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
- A pnpm and Turborepo monorepo: shared types, engine, server (the table logic, and a Node host for
  it), client, the client's transport, and the Cloudflare Worker.
- React with Vite, Tailwind CSS, Zustand, and React Router on the client; the authoritative engine
  in a Durable Object per table in production, or in a Node process.
- Vitest and fast-check for tests, and ESLint and Prettier for consistency.
- GitHub Actions runs type-checking, linting, tests, and formatting checks on every push and pull
  request.
- The whole game deploys as one Cloudflare Worker on the free plan: the Worker serves the built
  client and routes each table's requests to its Durable Object. The Worker's tests run inside the
  Workers runtime (workerd) and drive it with the real client transport, including eviction and
  hibernation. CI bundles the Worker exactly as a deploy would, and a passing build on `main`
  deploys it.

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

1. ~~Multi-round matches with escalating minimums and cumulative scoring.~~ Done: four rounds at
   60, 90, 120 and 150, the first turn rotating each round, and the next round dealt once every
   player still at the table is ready. Moving to the next round is an action like any other, so a
   match replays from its log across all its rounds.
2. ~~A configurable rules editor, since the engine is already fully config-driven.~~ Done: start
   from a preset and change any rule; the server checks the changes, and the lobby shows every
   player what was changed. See "Rules chosen when a room is opened".
3. An interactive tutorial that teaches the game through guided scenarios.
4. ~~Support for large tables on mobile.~~ Done: below 768px the table stacks vertically, with
   opponents as a strip of summary chips (tap one for its melds), the player's own melds as cards
   that can be collapsed to compact chips, and the hand in even rows sized to the screen, so no
   card ever overlaps another.
5. A competitive layer with accounts, matchmaking, and ranked play.
