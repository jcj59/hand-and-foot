# Hand and Foot — agent working notes

Online real-time multiplayer Hand and Foot (family card game). The platform is a means to an end:
the project's primary technical objective is a **self-play reinforcement-learning agent** that beats
human opponents. Read `DESIGN.md` for the full design rationale — it is the source of truth for
architecture decisions and trade-offs, and it is written as a portfolio document (careful prose, no
hype). Keep it that way when you edit it.

Repo: `~/dev/hand-and-foot`, remote `git@github.com:jcj59/hand-and-foot.git`.

## Layout

pnpm + Turborepo monorepo, TypeScript everywhere, seven workspace packages:

| Package | Name | State |
| --- | --- | --- |
| `packages/shared` | `@hf/shared` | Domain types, rules config, presets, client/server contract. Done for M1. |
| `packages/engine` | `@hf/engine` | Pure rules engine `(state, action) => newState`. **Complete (M1).** |
| `packages/server` | `@hf/server` | Authoritative table logic (`Room`, `TableChannel`, `RoomStore`) exported host-agnostically from `@hf/server/core`, plus a Node host for it (`ws` sockets, Postgres persistence, restore-on-boot). **Complete (M2, M4, M5).** |
| `packages/client` | `@hf/client` | React + Vite + Tailwind + Zustand app: lobby, table, SVG cards, meld staging. **Complete (M3).** |
| `packages/transport` | `@hf/transport` | The client's connection: HTTP to sit down, one WebSocket per table, reconnect with back-off, 25s keep-alive. Keeps Socket.io's `emit`/`on` surface. **M5.** |
| `packages/scenarios` | `@hf/scenarios` | The scenario library: hand-arranged tables, scripts resolved to actions, an autopilot for filler play. Pure; consumed by the client's dev-only viewer. **Roadmap item 1.** |
| `packages/worker` | `@hf/worker` | The production host: a Cloudflare Worker serving the client and a `TableObject` Durable Object per table code, hibernatable sockets, storage in the object's own SQLite KV. **M5.** |

The **libraries** are consumed **from source** — each `package.json` points
`main`/`types`/`exports` at `./src/index.ts`, and none of them has a build step;
`tsconfig.base.json` sets `noEmit: true`. `@hf/client` is an application, not a library, so it has
no `exports` at all and `pnpm build` runs Vite for it; `@hf/worker` is bundled by Wrangler, never
imported. Keep the libraries buildless — nothing imports them as bundles.

Running the server from source therefore needs a TypeScript runtime: `@hf/server` carries `tsx` as a
**runtime dependency** (production runs it too) and its `start`/`dev` scripts go through it. Node's
own `--experimental-strip-types` will not do — `moduleResolution: "Bundler"` means imports are
extensionless, which Node's ESM resolver does not accept.

## Commands

Run from the repo root. These are exactly what CI runs, in this order:

```bash
pnpm install --frozen-lockfile
pnpm typecheck        # turbo run typecheck -> tsc --noEmit per package
pnpm lint             # eslint . (flat config, typescript-eslint recommended)
pnpm test             # turbo run test -> vitest run per package
pnpm format:check     # prettier --check .
pnpm format           # prettier --write . (use this rather than hand-formatting)
```

The server's database tests (store contract, migrations, restart over real sockets, the real
opener in `main.ts`) run only when `HF_TEST_DATABASE_URL` is set, and skip otherwise. Each such
test file makes **its own database** beside that one (`testDatabase.ts`), because vitest runs files
in parallel and two files wiping one database fail in ways that look like the store's fault. A
local Postgres needs no root: `conda create -n pg -c conda-forge postgresql`, `initdb`, `pg_ctl
start` — this machine has one in `~/.local/share/hf-pg` on port 54329:
`HF_TEST_DATABASE_URL=postgres://postgres@localhost:54329/hf_test`. **Turbo drops environment
variables it has not been told about**, so `HF_TEST_DATABASE_URL` is declared on the `test` task in
`turbo.json` — without that, CI would skip every database test and still report green. Server
coverage is 100% only with the database tests running.

Turbo caches aggressively — a second `pnpm test` prints `FULL TURBO` and runs nothing. To force a
real re-run use `pnpm exec turbo run test --force`; `pnpm test -- --force` does **not** forward the
flag and exits non-zero. To run one engine test file:
`pnpm --filter @hf/engine exec vitest run src/<file>.test.ts`. Engine coverage:
`pnpm --filter @hf/engine test:coverage`.

To actually run a table locally:

```bash
pnpm --filter @hf/server start     # tsx src/main.ts
pnpm --filter @hf/server dev       # same, restarting on change
```

`PORT` (default 3000), the `HF_`-prefixed operational settings — `HF_CORS_ORIGINS`,
`HF_RECONNECT_GRACE_MS`, `HF_ABANDONED_ROOM_MS` — and `DATABASE_URL` configure it; see `env.ts`. A
value it cannot parse stops the process with a message rather than falling back to a default.

And the client, which needs the server running to be useful:

```bash
pnpm --filter @hf/client dev       # vite on :5173
pnpm --filter @hf/client build     # vite build -> dist/
```

The client is **always same-origin**: in production the Worker serves the page, and in development
Vite proxies `/api` (HTTP and WebSockets) to `HF_API_TARGET`, default `http://localhost:3000` (the
Node server); point it at `http://localhost:8787` for `wrangler dev`. `VITE_SERVER_URL` still
overrides the origin outright.

The production host, locally (builds the client first, serves both on :8787):

```bash
pnpm --filter @hf/worker dev       # wrangler dev
pnpm --filter @hf/worker run deploy  # client build + wrangler deploy (needs `wrangler login`)
```

`@hf/worker`'s tests run **inside workerd** via `@cloudflare/vitest-pool-workers`, which requires
**vitest 4**, so that one package pins vitest ^4.1 while the rest are on vitest 5. Its `test` task
depends on `@hf/client#build` in `turbo.json`, because Wrangler's assets directory is
`packages/client/dist`. CI also runs `wrangler deploy --dry-run` — the bundle is where a Node-only
import in `@hf/server/core` would first fail.

`tsconfig.base.json` sets `lib: ["ES2022"]` with no DOM lib, so runtime globals Node provides but
ES2022 does not type — `structuredClone`, `fetch`, timers on `window` — compile-fail even though
vitest runs them fine. Tests pass, `pnpm typecheck` doesn't. Run both. `@hf/client` adds
`DOM`/`DOM.Iterable` and `jsx: "react-jsx"` back in its **own** tsconfig rather than widening the base,
because the engine and server must keep failing on a stray browser global.

Note `.prettierignore` excludes `**/*.md`, so markdown is not format-checked — wrap prose in
`DESIGN.md` by hand at ~100 columns to match the existing style.

## Engine conventions (follow these — the engine is the most load-bearing code)

- **Purity is absolute.** No I/O, no networking, no `Date.now()`, no `Math.random()`. The engine must
  stay headlessly simulatable, because the RL agent depends on it.
- **Randomness is injected.** `prng(seed)` from `rng.ts` (mulberry32) returns an `Rng = () => number`.
  Any new shuffle derives its seed deterministically from `state.seed` (see the stock-reshuffle in
  `draw.ts`, which uses `seed + roundNumber + 1`) so replay stays exact.
- **One concern per file.** Action handlers are `applyX` in `x.ts` (`draw.ts`, `discard.ts`,
  `playMelds.ts`, `takePile.ts`), dispatched from `reducer.ts`. Predicates and helpers live in their
  own modules (`meld.ts`, `scoring.ts`, `goout.ts`, `feasibility.ts`, `legal.ts`, `view.ts`).
- **Return `ApplyResult`, never throw** for rule violations: `{ ok: true, state }` or
  `{ ok: false, error }`, built with `ok()` / `fail()` from `core.ts`. Error strings are lowercase,
  addressed to the player, and explain the rule ("you must play at least one card taken from the pile
  before discarding"). They surface in the UI, so write them for a human.
- **Validate against a working copy before mutating anything.** `applyPlayMelds` is the model: it
  builds up a candidate zone and meld map, and any failure returns `fail()` with the original state
  untouched. A partially-applied action is a bug.
- **Immutability helpers live in `core.ts`**: `activeCards(p)`, `setActiveCards(p, cards)`,
  `updatePlayer(state, seat, fn)`. Use them instead of hand-spreading players; the hand/foot
  distinction (`inFoot`) is easy to get wrong.
- **Types are `readonly` throughout** and live in `@hf/shared` — never redefine a domain type locally.
  Enums are string-literal unions, structs are `interface`.
- **Every new engine module must be re-exported** from `packages/engine/src/index.ts`.
- **Doc comments explain the rule and the *why*.** Existing JSDoc states the game rule being encoded
  and the design reason (e.g. why the pile obligation exists). Match that density; don't add comments
  that restate the code.

## Testing conventions

Tests are colocated as `*.test.ts` beside the source. Naming in `packages/engine/src`:

- `<module>.test.ts` — unit tests for that module (`meld.test.ts`, `scoring.test.ts`).
- `reducer.<feature>.test.ts` — end-to-end-through-the-reducer tests for one rule area
  (`reducer.takepile.test.ts`, `reducer.goout.test.ts`, `reducer.marva.test.ts`, …).
- `*.property.test.ts` — fast-check invariants (`invariants.property.test.ts`: card conservation,
  well-formedness after every accepted action).
- `replay.test.ts` — golden games as `(seed, actions)` asserted to a fixed final state.
- `view.test.ts` — the anti-cheat guarantee: a view sent to one player must not contain another
  player's hidden cards. **Any change to `view.ts` or `PlayerView` needs a test here.**

### Coverage status and how it was established (as of 2026-08-04)

`@hf/engine` is at **100% statements / branches / functions / lines** across all 20 modules (245
tests); `@hf/shared` has 25. Line coverage is treated as a floor, not the goal — the suite was then
validated by **mutation testing**: 98 deliberate single-edit bugs across the engine and 20 across
shared, each applied, tested, and reverted. Current state: **92/98 engine mutants killed with the
other 6 proven equivalent**, and **20/20 shared**.

If you add engine behavior, validate it the same way rather than trusting coverage: break the new
guard, confirm the intended test fails, restore, and confirm `git diff` is empty.

The 6 surviving engine mutants are *equivalent*. Five are unreachable because a second guard shields
them, each proven by removing that guard too and watching the suite fail; the sixth is an arithmetic
no-op. Don't "fix" these with a test; the state they need cannot be reached through `applyAction`:

| Mutation | Why it is unobservable |
| --- | --- |
| `advanceTurn`: `finalLap >= 0` instead of `> 0` | Reaching 0 sets `roundEnded`, and `applyAction` refuses every action after that, so `advanceTurn` never sees a 0. |
| `plan`: form a new meld from a natural **pair** | The `validateMeld(naturals)` line (the one marked `/* v8 ignore */`) rejects a 2-card meld first. That line is load-bearing despite being unreachable on its own — keep it. |
| `plan`: treat wilds as naturals | Same guard: an all-wild group fails `validateMeld`, so it is skipped. |
| `plan`: credit a book bonus the player already had | `value` is only *used* when `!isDown`, and a not-down player holds no melds, so `existing` is empty. |
| `policy`: drop `c.id !== card.id` from the companion count | Not a shielded branch but an arithmetic no-op: it adds exactly 1 to *every* candidate's `keepScore`, so the ranking — and the card chosen — is unchanged. Keep the clause anyway; "companions" means the *other* cards, and removing it would make the name a lie. |

The `plan` book-bonus row rests on a premise: **a not-down player never holds melds.**
`assertWellFormed` in `invariants.property.test.ts` checks it over thousands of random games. Since
roadmap item 2, `playMelds` leans on it openly: the minimum is checked with `layDownValue` (in
`marva.ts`) over the melds *after* the play, which equal the lay-down only because there were none
before — and the Marva check (`gotDownByMarva`) uses the same function, so the two cannot disagree.
(This removed the old `playMelds` "drop `before < 7`" equivalent mutant: the line is gone.) If the
premise ever breaks, `layDownValue` would count melds laid on earlier turns and `plan.ts` would add
`cleanBookBonus` (500) where `classifyBook` says dirty (300). Fix them together.

These three moved from `feasibility.ts` to `plan.ts` in M2a, when the lay-down search was extracted
so `canTakePile` and the default policy could not drift apart. The extraction was behaviour-preserving
— the whole M1 suite passed unchanged through it — but the mutants were re-run against the new home
rather than assumed to have travelled.

### Server testing (M2b, M2c, M2d)

`@hf/server` is also at **100%** (266 tests, with the database tests running; M4b's 20 mutants
were all killed). The load-bearing tests are the ones in
`socket.integration.test.ts` that drive *real* clients (Socket.io then, `@hf/transport` since M5) against a real server on an
ephemeral port: `project()` being clean says nothing about whether the transport routes the right
payload to the right socket, and that is what actually leaks a hand. Mutation tested the same way as
the engine — **14/14 killed**. Two only died after new tests were added, and both were security
holes the suite could not see:

- **the seat on `resumeSeat` came from the payload, not the token** — a player with their own valid
  token could name someone else's seat. Pinned now by a forged-seat test.
- **the room filter in `broadcastViews`** — the cross-room test asserted too early, so a stray view
  delivered a tick later slipped past. It now drains the loop before asserting.

M2c added 17 more mutants, all killed. Three only died after the tests were sharpened, and one of
those was a real defect rather than a test gap:

- **an absent player held the table for a full turn clock**, because `rearm` only ran on events so
  nothing woke up when the reconnect grace elapsed. Fixed by arming at whichever deadline comes
  first.
- **a fully abandoned table span at zero delay forever** — every seat absent means each forced turn
  re-arms immediately, and the default policy never ends a round to stop it. `rearm` now goes quiet
  on an abandoned room and leaves it to the reaper. Found because the mutation runner *hung*, which
  is worth remembering: a hanging suite is a killed mutant, so bound each run and treat a timeout as
  a failure.
- **pausing mid-grace** was only asserted as "still their turn", which cannot see a grace deadline
  left in the past, because the timer that fires on it is scheduled rather than immediate. Pin the
  deadline value, not just the seat.

M2d added 27 mutants over `env.ts` and `main.ts`, all killed. One only died after a test was added,
and it is worth keeping in mind as a shape of gap rather than a one-off: every port assertion compared
against the `DEFAULT_PORT` constant, so **changing the constant moved both sides of the comparison and
nothing failed.** A default that some other package will hard-code against is pinned to a literal
(`expect(DEFAULT_PORT).toBe(3000)`) for exactly that reason. Watch for the same trap wherever a test
imports the constant it is checking.

When mutation-testing the server, **check `git diff` afterwards**: a runner killed mid-mutation
leaves the edit on disk. It happened once here and was caught that way. Note that `git diff` says
nothing about a file that is still untracked — when the mutated module is new, compare against a copy
instead.

Socket tests must attach listeners **before** the call that triggers the broadcast. The server emits
immediately after the ack, so a listener attached afterwards misses it and hangs; use `waitFor` with
a predicate rather than a bare `once`, since an earlier broadcast can otherwise satisfy it.

### Client testing (M3a)

The bar is **split by kind**, deliberately, rather than one number for the package:

- **Pure modules get engine treatment** — 100% coverage *and* mutation testing. That is
  `serverTime.ts`, `credentials.ts`, `socket.ts` and `session.ts`: the logic where a bug is silent and
  costly. M3a ran 30 mutants over them, **29 killed with 1 proven equivalent** (removing the
  `raw === null` fast path in `loadCredentials` changes nothing, because `JSON.parse(null)` yields
  `null`, which then fails validation anyway — keep the guard, it is clearer than relying on that).
- **Components get behavioural tests** — React Testing Library, asserting what a player sees, with no
  coverage mandate. They happen to be at 100% too, but don't chase that through markup.

`main.tsx` is **not** instrumented at all: nothing imports it, so it never appears in the coverage
report rather than showing as 0%. It is the browser entry, the counterpart of the server's process
entry, and it is verified by actually running the app.

Client layering, which later parts should keep to: **components render state and call `actions.ts`;
they never touch the socket.** `actions.ts` owns the sequencing — send, await the ack, keep the seat
only if it was granted, put a refusal on the store as a notice — because that is the part worth
asserting without rendering anything. `socket.ts` below it is only the typed transport.

Three things that will bite:

- **A broadcast has to be wrapped in `act`.** Server events land in the zustand store from outside
  React, so without `act` the re-render is not flushed and the assertion reads stale DOM. The fake
  socket in `App.test.tsx` wraps `fire` for this reason. The symptom is a passing store and an
  unchanged screen.
- **The store's `clock` is a mutable singleton.** `useSession` is module state and the clock carries an
  offset, so a `beforeEach` that resets the store must *replace* the clock too — otherwise a test that
  anchored it leaks an anchored clock into the next one. This was a real failure while writing M3a.
- **jsdom provides no clipboard and its `localStorage` never throws.** Both are replaced with
  `Object.defineProperty` and restored in a `finally`; see `withClipboard` in `Lobby.test.tsx` and the
  blocked-storage test in `credentials.test.ts`. Testing those paths matters because both fail in
  ordinary situations — an insecure origin, a declined permission, a browser blocking site data — and
  neither is allowed to break the screen.

### The constant-on-both-sides trap (it has now happened twice)

A test that asserts against the very constant it is checking cannot fail when that constant changes,
because both sides of the comparison move together. It survived mutation testing twice:
`DEFAULT_PORT` in M2d and `RESYNC_THRESHOLD_MS` in M3a. Both are now pinned to a **literal**
(`expect(DEFAULT_PORT).toBe(3000)`). Any constant another package or a human decision depends on wants
one literal assertion alongside the symbolic ones.

### Vitest 5 (as of M3a)

The repo was on vitest 2.1.9, which resolves **Vite 5** internally, while the client app needs Vite 8
— vitest would have loaded `vite.config.ts` through the wrong major. All four packages moved to
**vitest 5**; the 434 existing tests passed unchanged, so nothing was adapted for it. Note that its v8
provider counts branches slightly differently and it **found a real gap** the old one missed: the room
filter on the `roundEnded` broadcast had no cross-room test, so scores could have leaked to another
table unnoticed. `vite.config.ts` imports `defineConfig` from `vitest/config`, not `vite`, or the
`test` block is a type error.

Rules tests go **through `applyAction`**, not through the internal handler, so the phase and dispatch
checks are exercised too. Fixtures are built inline per file with local `card()` / `cards()` /
`stateWith()` helpers — there is deliberately no shared fixture module, so each test reads
standalone. Copy the pattern from `reducer.getdown.test.ts`.

When fixing a rules bug: reproduce it as a seed + action sequence in `replay.test.ts` (a game that
once broke becomes a permanent regression test) or as a focused `reducer.*.test.ts` case, then fix.

## Git and PR workflow

- Branch off `main`, open a PR, squash merge. CI (`.github/workflows/ci.yml`) runs on every PR and on
  pushes to `main`.
- PR titles are lowercase milestone-scoped, e.g. `m1 rules engine`, `ci: remove pnpm version
  conflict in action-setup`.
- Work is tracked as `[M<n>] <task>` bullets in the PR body, not as GitHub issues (the repo has
  none). Merged so far: `m0 monorepo scaffold` (#1), `m1 rules engine` (#3).
- Use `npx -y gh-axi ...` for GitHub operations (a hook redirects plain `gh`).
- **Every PR that changes what players see carries before/after screenshots** (frames for an
  animation) in a `## Screenshots` section of its description — the user asked for this. The
  harness and upload scripts are in `scripts/pr-media/` (see its README); images live on the
  `pr-media` branch, uploaded through the GitHub API.

## Milestones

- **M0 — monorepo scaffold.** Done.
- **M1 — rules engine.** Done: deck/shoe, seeded shuffle, deal, view projection, meld validation,
  scoring + book classification, reducer (draw / takePile / playMelds / discard), lay-down minimum
  with book bonuses, foot transition (with and without a discard), Marva rule, red/black threes,
  take-pile feasibility solver, go-out conditions, round scoring, stock exhaustion, legal-move hints,
  property tests, golden-game replay.
- **M2 — server.** Done, split into four PRs so each was independently green:
  - **M2a — contract + default policy.** Done. `TurnTimers` replaces the old per-stage `StageTimers`, the
    socket contract lands in `@hf/shared/protocol.ts`, and `defaultAction` / `chooseDiscard` land in
    `@hf/engine/policy.ts` with the lay-down search extracted to `plan.ts`.
  - **M2b — rooms and transport.** Done. `RoomManager` (collision-free codes from a no-look-alike
    alphabet, case-insensitive lookup), `Room` (seats, seat tokens, host, pause, log, projection),
    `socket.ts` (ack callbacks, per-seat broadcast), `InMemoryActionLog` behind an `ActionLog`
    interface, and `clock.ts` with an injectable `Clock` + `FakeClock`.
  - **M2c — clock, pause, disconnect.** Done. Per-room turn clock (base -> increment per action ->
    hard cap, discard-only grace stacked on top), pause that credits back exactly the frozen time,
    reconnect grace, absent-player fast-forward, and abandoned-room reaping in `RoomManager`. Every
    timer test runs on `FakeClock` — nothing sleeps. Restart-from-log is deferred with the rest of
    persistence to M4.
  - **M2d — runnable entrypoint.** Done. `env.ts` parses `PORT` and the `HF_`-prefixed operational
    settings, `main.ts` binds the port and closes the rooms down on SIGTERM/SIGINT, and `tsx` runs it
    from source. Before this, `createServer` existed but nothing called it: the server was a library
    with no way to start one.
- **Reaping abandoned rooms is M2c work, and it is not optional.** A table where every seat is on the
  default *never ends the round*: `defaultAction` never melds voluntarily, so nobody gets down and the
  stock reshuffles out of the discard pile forever. Pinned by a property test in
  `invariants.property.test.ts`.
- **M3 — client.** Done, split into four PRs on the M2 pattern; the game is playable end to end.

  - **M3a — scaffold and the session layer.** Done. Vite + React 19 + Tailwind 4 + Zustand + React
    Router, jsdom/Testing Library set up, the typed socket wrapper with promise-shaped acks,
    `SeatCredentials` persisted for reload recovery, the zustand session store, and server-time
    anchoring. Also the protocol change below: `LegalHints` now rides in every `ViewUpdate`.
  - **M3b — lobby.** Done. `Home` (name, join by code, or open a table with a preset and mode),
    `Lobby` (shareable link, seat list with connection dots, host-only deal, leave), `actions.ts` as
    the one place that sequences a request against the store, `roomCode.ts` for normalizing what a
    person types, and auto-`resumeSeat` on load. Also moved `ROOM_CODE_ALPHABET`/`ROOM_CODE_LENGTH`
    and `MIN_PLAYERS`/`MAX_PLAYERS` into `@hf/shared` (re-exported from the server) so the client can
    validate a code and count seats without a second copy of either.
    Leave is a real `leaveRoom` request, not just forgetting the seat locally — otherwise the
    departed player's still-open socket held the seat (and the host) forever. In the lobby the seat
    is removed and the rest close up, so the server's socket sessions are keyed by **token, not
    seat number**, `resumeSeat` acks the resolved `SeatCredentials`, and a per-socket `seat` event
    tells a moved client its new number. Once dealt, the seat stays and is marked `left`, which
    `seatIsAbsent` treats as grace already expired. Only the seat's current owner socket may leave.
  - **M3c — table.** Done. `PlayingCard` (SVG, so a card scales with no assets and its rank and suit
    are real text), `Melds`, `Seats`, `TurnClock`, and the `Table` route. Hand ordering
    (`handOrder.ts`) groups cards by how they play rather than by rank: naturals ascending, then black
    threes, then wilds, then red threes, because a rank-only sort scatters the wilds to both ends and
    drops both kinds of three among the naturals. Draw and take-pile are wired; both are driven by
    `hints`, never by a local guess. Accessible names are load-bearing, not decoration — they are how
    the tests find one card among fourteen.
  - **M3d — staging and commit.** Done. `staging.ts` holds a lay-down as a plain value with pure
    transitions, and `previewLayDown` **mirrors `applyPlayMelds` step for step** — the same
    `validateMeld` / `naturalRank` / `cardValue` / `classifyBook`, the book bonuses that count toward
    the minimum, and the Marva waiver. It is a preview, never an authority; the point of reusing the
    engine's predicates is that it cannot quietly disagree with the answer. `StagingPanel` shows the
    running total, `Hand` rings the cards owed to the pile, and the discard is gated on the play phase
    plus a settled obligation. Also added `pickedUp` to `PlayerView` (see below).

- **`PlayerView.pickedUp` carries the viewer's own take-pile obligation.** Added in M3d because
  without it the client cannot say why a discard is about to be refused, or which cards would settle
  it. It is the viewer's own information — those cards are in the hand they can already see — and it
  is projected only for the receiving seat; `OpponentView` has no such field, so another seat's is
  unrepresentable rather than merely omitted. `view.test.ts` pins all of that, per the rule that any
  change to `view.ts` or `PlayerView` needs an assertion there.

- **A wild needs a target before it can be staged.** A wild has no rank of its own, so `stageCard`
  attaches it to the *focused* group and refuses to guess otherwise — guessing would be guessing at
  the only decision a wild involves. A natural takes focus as it is staged, and the "Add to Ks"
  buttons focus a rank whose book is already down, which is the only way to aim a wild at a book when
  no natural of that rank is left in hand.

- **Legality hints cross the socket; the client does not compute them.** `LegalHints` moved from
  `@hf/engine/legal.ts` to `@hf/shared` (re-exported from the engine, so existing importers are
  unaffected) and `Room.viewFor` now fills it in per seat. The reason is structural: `canTakePile`,
  `canGoOut` and `meldableRanks` are decided by predicates that read the whole `GameState`, and a
  client only ever holds its own `PlayerView` — so the alternative was a second copy of the legality
  rules in the UI, free to drift from the reducer. It leaks nothing (booleans, a seat, and ranks, all
  about the seat's own cards and the face-up pile), and the wrong-seat bug is the one that matters:
  computing them for `currentSeat` instead of the recipient both misleads that client and tells it
  something about another hand. Pinned in `room.test.ts` and over the wire in
  `socket.integration.test.ts`, and both wrong-seat mutants were confirmed killed.
- **M4 — deploy.** Server on Fly.io, client on Vercel, Postgres on Neon. **Superseded by M5**: the
  Fly/Vercel/Docker files were removed when hosting moved to Cloudflare (the M4b persistence and
  Node host remain, for local play and self-hosting).
  - **M4a — keeping a seat across a reconnect (PR #12).** A new transport connection is a new
    socket to the server, and a seat belongs to a socket only once it has presented the token — but
    the client used to reclaim its seat only on page load. So any network blip, and *every server deploy*,
    left the tab showing a connected table whose moves were all refused as "not seated" while the
    server played the seat after the grace. `reclaimOnReconnect` (in `actions.ts`, wired in `App`)
    re-sends `resumeSeat` on every reconnect while the store holds a seat. `reclaimSeat` tells
    **gone** (refused: discard the credentials, go home with a notice) from **unreachable** (no
    ack: keep them, the next reconnect retries) via `NO_RESPONSE` — before this, a slow server on
    load also threw the stored seat away. `reconnect.integration.test.ts` is the client's first
    test against a real server (`@hf/server` is a client devDependency for it), because only a real
    server can say whether the new socket is actually seated.
  - **M4b — persistence and deployment.** `store.ts` defines `RoomStore` (a `RoomRecord` per room —
    seating, dealt, paused — plus its `LoggedAction` log) with `InMemoryRoomStore` for tests and
    `PostgresRoomStore` (`postgres.ts`) for production: versioned `MIGRATIONS` under an advisory
    lock, and `WriteBehind`, an ordered queue that retries then logs and drops. `Room.restore`
    replays the log over a fresh deal and **refuses** a room that does not add up rather than
    rebuilding a different game; `RoomManager.restore` closes and reports those. Rooms are keyed by
    `uid`, not code (codes recur). `remove`/`sweep` close a room in the store; `disposeAll` (a
    shutdown) deliberately does not. `startFromEnv` opens `DATABASE_URL`, restores before
    listening, and **refuses to boot** if a configured database is unreachable or its rooms cannot
    be loaded. Shutdown is bounded: `WriteBehind.close` stops retrying, waits at most
    `DEFAULT_SHUTDOWN_DEADLINE_MS` (20s, pinned as a literal — it must stay under `kill_timeout`
    30s in `fly.toml`), then abandons the rest with one log line naming every abandoned write, so a
    DB outage mid-deploy rolls those rooms back a few moves on record. `/healthz` for Fly.
    Deploy files: `Dockerfile` (prod-only install; `node --import tsx src/main.ts` so the server
    itself gets SIGTERM), `fly.toml` (one machine, `rolling`, never bluegreen — two servers would
    write the same rooms), `vercel.json`, `.github/workflows/deploy.yml` (Fly on green `main`, a
    no-op until `FLY_API_TOKEN` exists; the `workflow_run` path also requires a `push` event from
    this repository, because `branches: [main]` matches a fork PR's branch named `main` too). CI
    gained a Postgres service, the client build, and an image job that smoke-tests `/healthz` and a
    clean SIGTERM exit. No Docker on this machine, so the image was verified by replaying its steps
    in a scratch dir and running that tree as a real process through a SIGTERM restart against
    Postgres.
  - **A pending foot is picked up automatically** when the turn reaches that player (in
    `advanceTurn`), replacing their draw; `applyDraw` no longer handles `footPending`. So an action
    log recorded before that change which contains a foot-pickup `draw` **no longer replays**: the
    logged `draw` meets a turn already in the play phase and is refused, and `Room.restore` closes
    such a room rather than rebuilding a different game. That is by design — nothing had been
    deployed, only local test tables were affected — so there is no compatibility code for it.
  - `pnpm start` does not forward SIGTERM (exit 143, no graceful shutdown) — never use it as a
    container command.
- **M5 — free hosting on Cloudflare.** The requirement was literally $0/month for a family game,
  always on. One Worker + one Durable Object per table code (`getByName(code)`); see DESIGN.md
  "Hosting: a Durable Object per table".
  - **M5a — one wire protocol.** Socket.io replaced by `@hf/shared/wire.ts`: `POST /api/rooms`,
    `POST /api/rooms/:code/join`, WS `/api/rooms/:code/socket`, JSON frames `{id,event,payload}` →
    `{ack,result}` or `{event,payload}`. `TableChannel` (server `table.ts`) is the per-table
    protocol both hosts drive; `lobby.ts` has the Node host's open/join. Seats taken over HTTP are
    disconnected until a socket presents the token.
  - **M5b — the Worker.** `TableObject` restores from storage in its constructor, accepts sockets
    with `ctx.acceptWebSocket` (hibernation), stores `{connection, token}` in each socket's
    attachment, and on wake re-seats them via `TableChannel.adoptSeat` — silently. `RoomRecord`
    gained `nextRoundReady`, `wentOn`, `nextRoomId` (Postgres column `waiting`, migration 3) so a
    wake does not forget them. The client pings `"ping"` every 25s (Cloudflare drops idle sockets
    at ~100s); the object answers via `setWebSocketAutoResponse` without waking.
  - **A running turn clock keeps the object awake** (a pending `setTimeout` blocks hibernation), so
    tables sleep only in the lobby, between rounds and while paused. Fine on the free plan (~450
    GB-s per hour of play vs 13,000/day). Moving the clock to alarms would need persisted deadlines.
  - **Testing gotchas:** `evictDurableObject` *waits* for pending timers ("still has active
    references") where a real restart would not — tests cancel the room's timer first
    (`stopClock`). Eviction with `webSockets: "close"` only affects hibernatable sockets.
    `compatibility_date` cannot be newer than the local workerd supports (2026-08-15 now).
- **Table lifetime (post-M5).** `Room.closing(abandonedMs)` is the one rule both hosts close tables
  by (Node `RoomManager.sweep`, the Durable Object's alarm via the `TableHooks.changed` hook):
  paused → `PAUSED_TABLE_MS` (30 min) after `pausedSince`; saved for later (family only, while
  paused) → `SAVED_TABLE_MS` (7 days); else abandoned → `abandonedMs` after the last seat left. A
  full lap of clock-played turns with no player move pauses the table itself (`idlePaused`, any
  mode, anyone may resume). Clock tests that let the server play many turns opt out with
  `RoomDeps.pauseWhenIdle: false`. Closing sends `tableClosed {reason}`; the client goes home with
  a notice. Reloading the home screen no longer auto-rejoins a stored seat — only the table's own
  URL does; Home's Rejoin reads the saved credentials.
- **Phone layout (post-M5).** `usePhone` (`matchMedia("(max-width: 767px)")`) switches the table to
  a stacked layout: `OpponentStrip` chips with a modal melds sheet, the player's own melds as cards
  (collapsible to chips, remembered per device), and the hand in even, non-overlapping rows of
  46px `medium` cards sized to the measured width (`evenRows`/`perRow` in `Hand.tsx`). The footer
  holding the hand is capped at `48dvh` and scrolls, so a small phone keeps the piles in view; for
  that reason a card's menu opens as a bottom sheet portalled to `document.body`, not above the
  card, where the scrolling footer would clip it. On a computer the other players are shown in
  full, but a "Collapse players" toggle swaps in the same `OpponentStrip` (remembered per device,
  `hf.compactSeats`). jsdom has no `matchMedia`, so tests get the desktop layout by default; phone
  tests define `window.matchMedia` matching `PHONE_QUERY` and delete it afterwards.
- **Take-back and the latest move (post-M5).** `takeBack` (engine `takeBack.ts`) restores
  `GameState.turnBase`, the seat before the turn's first play; `withTurnBase` keeps the *first*
  base, and `withoutTurnBase` (in `core.ts`) clears it at turn end, at go-out, and when a play
  empties the hand into the foot (foot cards seen ⇒ earlier plays final). `PlayerView.playedThisTurn`
  is own-seat only (pinned in `view.test.ts`). Mutation-tested: all killed except one equivalent —
  `playedThisTurn`'s `state.currentSeat !== seat` guard, since a base only ever exists for the seat
  on turn. The server's `Room.noteMove` sets `ViewUpdate.lastMove`; the drawn card is stripped for
  every other seat (pinned in `room.lastmove.test.ts` and over the wire). The client's
  `useMoveNews` announces others' discards/pickups once per `seq` and marks the player's own draw.
- **Card animations.** FLIP, no library: `table/motion.ts` plans (pure, unit-tested) and
  `table/cardMotion.ts` plays them with the Web Animations API. Cards carry `data-motion` (their
  ids; a collapsed book or chip lists all of its cards), places carry `data-anchor` (`stock`,
  `discard`, `seat-N`), and zones carry `data-zone` (`hand`, `melds`, `pile`, `seat`). Only a card
  that changed zone slides — plus the hand closing up — because a meld that grew shifts the rest by
  layout alone; and a card scrolled out of view (clipped by a scrolling ancestor) is never flown,
  or its copy is drawn over the hand. Movement runs only when a new `lastMove.seq` arrives; jsdom
  has no `animate` and reduced-motion users get none, so tests see a static table. Verify visually
  with Playwright frames captured right after a change (headless Chromium needs `LD_LIBRARY_PATH`
  at the `pwlibs` conda env for nss/nspr/alsa on this machine).
- **Sounds.** `table/sounds.ts`. Card sounds are recordings from Kenney's Casino Audio (CC0) in
  `client/public/sounds` (licence file beside them), loaded after the first gesture, with a
  synthesized flick standing in until they arrive; the chimes are synthesized with Web Audio.
  `soundsFor` (pure, tested) maps a change in `{moveSeq, moveKind, myTurn, result}` to sounds:
  **one** recording per move, by kind, however many cards it moves, a chime when the turn comes to
  this player, phrases for round and match end. The `AudioContext` is created on the first user
  gesture (`UNLOCK_EVENTS`; a touch only counts when it ends, so both ends of a press are listened
  for) per browser autoplay rules, and closed on unmount; mute is per device (`hf.muted`).
- **Grabby Pants.** `engine/src/grabby.ts` (moved from the server in roadmap item 1, so replay and
  the scenario viewer derive the same holder) works out, from the action log, who has taken the pile
  most times running this match: 3 in a row (`GRABBY_STREAK`, pinned) earns the title; taking it
  needs a streak longer than the holder's best; another player drawing does not break a streak,
  only someone else taking the pile. Sent as `RoomInfo.grabbyPants {seat, streak, from?}`. The
  client renames the holder "Grabby Pants" with a drawn icon (`table/grabby.tsx`), announces a
  new holder on every screen (through the shared `table/Celebration.tsx` overlay since item 2), and
  says "Grabby Pants" with the device's speech synthesis at its lowest pitch (unless muted; speech
  is unlocked on the first tap, like audio).
- **Marva Rule celebration (roadmap item 2).** `table/marva.tsx`: `useMarvaCelebration` shows
  `MarvaCelebration` (big "Marva Rule", drawn party horns, 80 pieces of deterministic CSS confetti
  from `Celebration`) when a *new* `lastMove` with `marva` arrives — never for the move the page
  opened on, nor on a `quiet` replay jump. Unless muted, `sayDeep("Marva Rule")` (the Grabby voice,
  generalized in `grabby.tsx`, with a give-up timer because some browsers never fire `onend`) is
  followed by the `airhorn` sound, which is **synthesized** in `sounds.ts` (detuned saws, soft
  clipper, band-pass, three stabs and a long blast): no scripted download of a DJ sample was
  available, and synthesis needs no asset. `useTableSounds` now returns `playSound` for one-offs.
  Reduced motion hides the confetti and the pop; the announcement stays. `Celebration` takes its
  duration as `--celebration-ms`, which the CSS animation reads.
- **Identity (roadmap item 4a).** `@hf/shared/identity.ts`: `UserCredentials {userId, secret}`
  (ids 16–64 and secrets 32–128 URL-safe chars, `isUserCredentials`), `normalizeName`
  (`MAX_NAME_LENGTH` 24), transfer codes `hf1.<id>.<secret>`. Server `users.ts` (host-agnostic):
  `UserStore` (`InMemoryUserStore`, `PostgresUserStore` from migration 4, reached through the
  optional `RoomStore.users()`), only a SHA-256 of the secret is kept, `registerUser` creates or
  confirms-and-renames (`existing: true` refuses an unknown id — used for transfers so a typo
  never mints an identity), `verifyUser`. `POST /api/users` on both hosts; create/join bodies may
  carry `user`, verified before the table sees it, and a failed check **seats the player
  anyway, anonymously**. `RoomPlayer.userId` / `SeatRecord.userId` persist with the seat (JSON
  column, no migration), travel to the next game, and are **not** in `RoomInfo`. On Cloudflare
  each identity is its own `UserObject` Durable Object (`USERS` binding, migration tag `v2`) —
  chosen over D1 because it needs no resource created by hand and fits the free plan; the Worker
  checks the id's shape before addressing an object by it. Client `identity.ts`: identity made
  on first need (`hf.identity`), name remembered (`hf.name`, pre-filled on Home),
  `prepareIdentity` registers on sit-down (replacing an identity the server says is someone
  else's, giving up after `REGISTER_TIMEOUT_MS` 4s rather than blocking), and Home's folded
  "Use your profile on another device" panel shows/accepts transfer codes. Seat tokens remain
  the only authority to act. Server DB tests now drop `users` too when they wipe.
- **Quick reactions (roadmap item 3).** A fixed list, `REACTIONS` in `@hf/shared/protocol.ts`
  (six emoji, six phrases); only an id crosses the wire (`isReactionId` is the server's check), so
  there is nothing to moderate. `react {id}` → `Room.react` (seat valid, id valid, and a per-seat
  token bucket in `server/src/reactions.ts`: burst `REACTION_BURST` 3, one more per
  `REACTION_REFILL_MS` 2s, on the injected clock) → `TableChannel` acks and sends `reaction
  {seq, seat, id}` to every seated connection, the sender too. Never logged, never in the record:
  the bucket lives in memory and a wake simply refills it. Client: `session.reactions` keeps the
  last `KEPT_REACTIONS` (16), reset with the table; `table/reactions.tsx` has the picker (menu on a
  computer, opening towards the side with room; bottom sheet portalled to `body` on a phone),
  `REACTION_COOLDOWN_MS` (1.5s) rest after sending, and `useReactionBubbles`, which shows each
  seat's latest for `REACTION_SHOW_MS` (3s) inside its seat box (the seat lists scroll, so a bubble
  outside the box would be clipped) and by the player's own hand. Reactions already in the store
  when the table mounts are not replayed. "Mute other players' reactions" is per device
  (`hf.muteReactions`) and hides theirs and their blip sound, never your own. A watched table
  (`controls` null) has no picker. Emoji need a colour emoji font: real devices have one, headless
  Chromium does not (see `scripts/pr-media/README.md`, `EMOJI_FONT`).
- **Scenario library and autoplay viewer (roadmap item 1).** Three layers, kept apart on purpose:
  - **Engine, `playback.ts`:** `buildTimeline(GameLog)` takes any `{ config, setup: {seed,
    playerCount} | {state}, actions, names?, moments? }` — a scenario, a golden game, a recorded
    match — replays it once (throwing `TimelineError` naming the step on a refused action), keeps a
    checkpoint every `CHECKPOINT_EVERY` (32) steps plus the last state asked for, and finds turn and
    round spans and the automatic moments (`pileTaken`, `gotDown`, `footPickedUp`, `grabbyPants`,
    `wentOut`, `roundEnded`, `matchOver`) for any input. Step `k` is the state after `k` actions.
    `describeMove`/`moveSeenBy`/`roundResult` (`lastMove.ts`) and `grabbyPants`/`grabbyHistory`
    (`grabby.ts`) moved here from the server so live tables and replays say the same thing; the
    server's `Room` now calls them. Golden-game recorders are exported as `@hf/engine/testing`
    (excluded from engine coverage: test support, not engine).
  - **`@hf/scenarios`:** `arrange(TableSpec, config)` builds a position from card shorthand (`KH`,
    `10S`, `JK`; suits required, so a three is never ambiguous) — named cards are claimed from a real
    shoe and the rest dealt from the seed, so every card exists exactly once. Scripts
    (`draw()`, `meld({ K: "KC KD KH" })`, `discard("9S")`, `moment(id, label)`, `autoTurns(n)`,
    `autoUntil("round" | "match")`) resolve against the active zone of the seat on turn. The
    autopilot is filler play only (not item 7's bot) and some seeds never finish a round once the
    shoe is melded out, so `autoUntil` gives up at `AUTO_ACTION_LIMIT` — pick seeds that end.
  - **Client:** `table/TableView.tsx` is the whole table, driven by props and an optional
    `TableControls` (null = watching: nothing clickable, no clock, the seat named instead of "your");
    `routes/Table.tsx` is now only the session/socket wrapper. `playback/` is the reusable player
    (pure `frameAt`, `playbackReducer`, `navigate.ts`, and `Player.tsx`) with no scenario knowledge;
    item 5's replay should only need a new data source. A frame goes through `project`,
    `legalHints` and `moveSeenBy`, and `frame.test.ts` checks no hidden card leaks at any step. A jump
    (seek, step back, instant speed) carries no `lastMove` and sets `quiet`, so nothing animates,
    sounds or announces; playing forward numbers each step afresh (`playedAs`). `scenarios/` is the
    dev route: mounted by `main.tsx` **instead of** the app at `/scenarios` (no socket), only in
    development or a build with `VITE_SCENARIOS=1` (the screenshot harness; declared on turbo's
    `build` env). The condition is written inline in `main.tsx` on purpose: imported as a flag from
    another module, Vite still emitted the viewer's chunk in production. Links: `/scenarios/<id>#moment=<id>`
    or `#step=n&seat=n&all=1`; `/scenarios/all` (`?moments=1` for windows around named moments).
  - **Adding a scenario** is one entry in `SCENARIOS` (`packages/scenarios/src/library.ts`): an id,
    title, description, config, a `TableSpec` or seed, names, a script, and optionally `watch`.
    `library.test.ts` replays every entry; add an assertion there that the scenario shows what it
    claims (it is easy to write a script that is legal but demonstrates nothing).
  - Mutation-tested: all new engine guards killed but one equivalent — the checkpoint cache's
    `cached.step >= base` bound, which only chooses the shorter of two replays to the same state.
- **Bot milestone — the RL agent.** The point of the whole project. Design not yet written; the
  section in `DESIGN.md` is a placeholder. Observation = `PlayerView` (by construction the agent
  cannot see more than a human), reward is end-of-round. The evaluation baseline is **not**
  `defaultAction`: that is a safe timeout default that never melds, so it never scores and never ends
  a round. A playing heuristic strong enough to be a baseline is separate work; it belongs beside
  `defaultAction` in `policy.ts` and should reuse `chooseDiscard`. `LoggedAction.source` marks which
  moves were forced, so timeouts can be filtered out of any imitation-learning corpus.

## Known wrinkles and open questions

### Settled rules decisions (2026-08-04) — don't relitigate these

- **`Phase` is `"draw" | "play"`.** The unused `"discard"` member was dropped. The discard *ends* the
  play phase rather than being one; a player who has shed every card ends the turn without one. The
  M3 client derives "you must discard now" from the play phase plus a settled take-pile obligation.
- **`initialDiscardFlip` is `true`** and confirmed as the house rule — no longer an assumption.
  Turning it off is still supported and tested.
- **Scoring is individual, not partnership.** Melds belong to a player, and the solver, minimum,
  go-out check and round scoring all assume that. Partnership play would move melds to a team and
  touch all of them; see the rationale in `DESIGN.md`. Don't add team logic without that being an
  explicit new decision.
- **A match is `config.rounds` rounds (4 in both presets), minimums 60 / 90 / 120 / 150.** Moving
  to the next round is an ordinary action, `{ type: "nextRound" }`, accepted only once a round has
  ended and it was not the last (`isMatchOver`). It deals round r from `roundSeed(seed, r)` — round
  1 is the match seed itself, so every game recorded before rounds existed replays unchanged — with
  the first turn rotating one seat per round, and appends the finished round's `scoreRound` to
  `GameState.pastRounds`; `matchTotals` adds them up. Because it is an action, the server logs it
  and a restart replays a match across rounds. The server deals it once everyone still at the table
  has said ready (`Room.readyForNextRound`, `RoomInfo.nextRoundReady`); a player who leaves is not
  waited for. `RoundEnded` carries `roundNumber`, `totals` and `matchOver`; `PlayerView.scoresSoFar`
  carries the finished rounds' totals. Play again (a new game) is offered only once the match is
  over.
- **`canTakePile` spends wilds, but only as needed, and stays sound.** It used to meld naturals
  only, which refused plainly legal takes (two queens and a joker could not take a queen) — found in
  a real game. `greedyLayDown` now melds naturals, then spends wilds highest-value first only while
  the goal is unmet: a pile card's pair made a meld with a wild, then the single best-gain move
  under the table's wild ratio. It is still sound rather than optimal: every group passes
  `validateMeld` with the meld it joins. It takes the round `minimum` (`layDownMinimum`) and sorts
  its input, because the policy discharging a take must find the plan that authorized it — the
  property test now checks that after every take. Exotic lay-downs can still be missed; smarter
  search is bot-milestone work.
- **The Marva rule is on in both presets (roadmap item 2, 2026-10-01).** `EAST_COAST.marvaRule` is
  `true` and West Coast inherits it. Tables persisted earlier keep the config stored in their record
  (`marvaRule: false`) and restore unchanged; their logs also replay under the new preset, since the
  rule only loosens the minimum — both pinned in `room.restore.test.ts`. A lay-down that got its
  player down *only* through the waiver is decided by `gotDownByMarva` and carried to every seat as
  `LastMove.marva`; the timeline marks it as a `marva` moment.
- **Shedding every card is not going out.** A player may legally play or discard their last foot card
  without the go-out books; they keep no cards, the round continues, and they draw one card per turn
  until the books are complete. So `player.hand.length + player.foot.length === 0` does **not** mean
  that player went out — `state.wentOutSeat` does, and only that seat earns `goOutBonus`. A turn that
  ends with an empty foot ends without a discard (the reducer advances the turn itself; there is no
  `endTurn` action). Keep this in mind for the M3 client UI and for the agent's action space.
- **A cardless player is still an active player.** They take normal turns: `draw` appends to their
  empty foot (`activeCards` is the foot once `inFoot`), and `takePile` is available whenever the pile
  extends one of their melds or forms a natural triple — the lay-down minimum does not apply because
  reaching zero cards requires being down. That is their route back into contention, so don't add
  short-circuits that skip a cardless seat's turn. `reducer.cardless.test.ts` covers it, including
  digging out of nothing via the pile to complete the last book and go out.
- **Exactly one player goes out per round.** Use `claimsGoOut(state, player)` from `goout.ts`, never
  bare `canGoOut`, at the two points where a zone empties (`discard.ts`, `playMelds.ts`) — it also
  requires that `wentOutSeat` is still unset. Otherwise a player who sheds their last card during the
  final lap while holding the books steals the go-out (and, via `playMelds`, restarts the final lap).
  `reducer.shedall.test.ts` covers this.
- **Local pnpm drift — resolved, but stay alert (as of 2026-09-26).** The local pnpm is 9.15.9 and
  matches `packageManager`, so `pnpm install` is currently safe and leaves the lockfile alone. The
  hazard that caused the earlier drift has not gone away: a globally installed pnpm 12 self-pins on
  `pnpm install`, rewriting `packageManager` plus `pnpm-lock.yaml` / `pnpm-workspace.yaml`, and CI's
  `pnpm/action-setup@v4` reads `packageManager` — so that would put a prerelease pnpm in CI, which PR
  #2 already existed once to fix. After any `pnpm install`, check `git status` for those three files
  and `git checkout --` them unless the upgrade is deliberate.
