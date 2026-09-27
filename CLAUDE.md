# Hand and Foot — agent working notes

Online real-time multiplayer Hand and Foot (family card game). The platform is a means to an end:
the project's primary technical objective is a **self-play reinforcement-learning agent** that beats
human opponents. Read `DESIGN.md` for the full design rationale — it is the source of truth for
architecture decisions and trade-offs, and it is written as a portfolio document (careful prose, no
hype). Keep it that way when you edit it.

Repo: `~/dev/hand-and-foot`, remote `git@github.com:jcj59/hand-and-foot.git`.

## Layout

pnpm + Turborepo monorepo, TypeScript everywhere, four workspace packages:

| Package | Name | State |
| --- | --- | --- |
| `packages/shared` | `@hf/shared` | Domain types, rules config, presets, client/server contract. Done for M1. |
| `packages/engine` | `@hf/engine` | Pure rules engine `(state, action) => newState`. **Complete (M1).** |
| `packages/server` | `@hf/server` | Authoritative Socket.io server: rooms, seats, per-seat broadcast, turn clock, action log, runnable entrypoint. **Complete (M2).** Postgres persistence = M4. |
| `packages/client` | `@hf/client` | React + Vite + Tailwind + Zustand app. Scaffold, socket layer, session store and clock anchoring done (M3a); lobby, table and staging = rest of **M3**. |

The three **libraries** are consumed **from source** — each `package.json` points
`main`/`types`/`exports` at `./src/index.ts`, and none of them has a build step;
`tsconfig.base.json` sets `noEmit: true`. `@hf/client` is the exception and the only one: it is an
application, not a library, so it has no `exports` at all and `pnpm build` now runs Vite for it. Keep
the libraries buildless — nothing imports them as bundles.

Running the server from source therefore needs a TypeScript runtime: `@hf/server` carries `tsx` as a
devDependency and its `start`/`dev` scripts go through it. Node's own `--experimental-strip-types`
will not do — `moduleResolution: "Bundler"` means imports are extensionless, which Node's ESM
resolver does not accept.

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

`PORT` (default 3000) and the `HF_`-prefixed operational settings — `HF_CORS_ORIGINS`,
`HF_RECONNECT_GRACE_MS`, `HF_ABANDONED_ROOM_MS` — configure it; see `env.ts`. A value it cannot parse
stops the process with a message rather than falling back to a default.

And the client, which needs the server running to be useful:

```bash
pnpm --filter @hf/client dev       # vite on :5173
pnpm --filter @hf/client build     # vite build -> dist/
```

`VITE_SERVER_URL` points it at the server, defaulting to `http://localhost:3000` to match the
server's own default. The two run on **separate origins in development on purpose**, because that is
how they deploy (Vercel and Fly.io), so CORS is exercised locally instead of discovered on release —
which means the server needs `HF_CORS_ORIGINS=http://localhost:5173` to be strict locally, and is
wide open by default.

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
| `playMelds`: drop `before < 7` when awarding a book bonus | Same reason — that block only runs under `if (!player.isDown)`, where `beforeSize` is provably empty. |
| `policy`: drop `c.id !== card.id` from the companion count | Not a shielded branch but an arithmetic no-op: it adds exactly 1 to *every* candidate's `keepScore`, so the ranking — and the card chosen — is unchanged. Keep the clause anyway; "companions" means the *other* cards, and removing it would make the name a lie. |

The last two share a premise: **a not-down player never holds melds.** `assertWellFormed` in
`invariants.property.test.ts` checks it over thousands of random games. If multi-round play ever
breaks it, both lines go live *and* they disagree — `plan.ts` adds `cleanBookBonus` (500)
unconditionally while `playMelds` uses `classifyBook` (300 for a dirty book). Fix them together.

These three moved from `feasibility.ts` to `plan.ts` in M2a, when the lay-down search was extracted
so `canTakePile` and the default policy could not drift apart. The extraction was behaviour-preserving
— the whole M1 suite passed unchanged through it — but the mutants were re-run against the new home
rather than assumed to have travelled.

### Server testing (M2b, M2c, M2d)

`@hf/server` is also at **100%** (160 tests). The load-bearing tests are the ones in
`socket.integration.test.ts` that drive *real* Socket.io clients against a real server on an
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

Two things that will bite:

- **A broadcast has to be wrapped in `act`.** Server events land in the zustand store from outside
  React, so without `act` the re-render is not flushed and the assertion reads stale DOM. The fake
  socket in `App.test.tsx` wraps `fire` for this reason. The symptom is a passing store and an
  unchanged screen.
- **The store's `clock` is a mutable singleton.** `useSession` is module state and the clock carries an
  offset, so a `beforeEach` that resets the store must *replace* the clock too — otherwise a test that
  anchored it leaks an anchored clock into the next one. This was a real failure while writing M3a.

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
- **M3 — client.** In progress, split into four PRs on the M2 pattern:
  - **M3a — scaffold and the session layer.** Done. Vite + React 19 + Tailwind 4 + Zustand + React
    Router, jsdom/Testing Library set up, the typed socket wrapper with promise-shaped acks,
    `SeatCredentials` persisted for reload recovery, the zustand session store, and server-time
    anchoring. Also the protocol change below: `LegalHints` now rides in every `ViewUpdate`.
  - **M3b — lobby.** Not started. Home → create/join, room code and shareable link, seat list with
    connection state, host-only start, rules preset and mode on create, and auto-`resumeSeat` on load
    from the stored credentials.
  - **M3c — table.** Not started. SVG cards, hand, opponents' counts, melds, discard pile, stock
    count, turn indicator, and the turn clock rendered through `serverTime.ts`.
  - **M3d — staging and commit.** Not started. The subtle one: staging melds locally with a running
    total against the round minimum (reusing `validateMeld` / `meldPoints` from the engine rather than
    reimplementing them), the take-pile obligation, "you must discard now", and the go-out affordance.

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
- **M4 — deploy.** Not started. No `Dockerfile` or `fly.toml` exists yet; the plan is server on
  Fly.io, client on Vercel, Postgres on Neon. One thing already established by hand: the container
  must exec the server **directly** (`tsx src/main.ts`), not via `pnpm start`. The pnpm wrapper does
  not forward SIGTERM, so through it the process is killed outright (exit 143) and the graceful
  shutdown never runs — verified both ways locally.
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
- **`config.rounds` is reserved and unenforced.** Nothing reads it and nothing advances `roundNumber`
  past 1. `layDownMinimums` *is* honored per round, so escalating minimums work the moment rounds
  advance. Wire both up in roadmap item 1, not before.
- **`canTakePile` is deliberately conservative.** It is sound (a reported plan is always completable)
  but does not optimize wild allocation across ranks, so it can refuse a legal take in wild-heavy
  positions. Improving it is bot-milestone work; preserve soundness.
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
