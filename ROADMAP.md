# Hand and Foot — implementation roadmap

An ordered list of work, written to be handed to an agent **one PR at a time**. Take the lowest-numbered
item whose dependencies are merged. Each item is scoped to be one reviewable, independently green PR;
an item marked *may split* can be shipped as `a`/`b` PRs if it grows, on the M2/M3 pattern.

Mark an item done by striking its heading through and adding the PR number, as `DESIGN.md`'s roadmap
does.

## Read before starting any item

- `CLAUDE.md` (operational rules, testing conventions, known wrinkles) and the relevant sections of
  `DESIGN.md`. Both are binding; this file does not repeat them.
- **Engine purity is absolute**: no I/O, `Date.now()` or `Math.random()` in `@hf/engine`. Anything new
  that the agent, replay, or scenarios depend on must stay headlessly simulatable.
- **Anti-cheat**: any change to `view.ts`, `PlayerView`, `ViewUpdate` or `lastMove` needs a matching
  assertion in `view.test.ts` (and over the wire where the server is involved). Nothing may reveal a
  hidden card to a seat that could not see it at a real table.
- Rules bugs are reproduced as tests through `applyAction` before fixing. New engine behaviour is
  mutation-tested, not just covered.
- **Every PR that changes what players see carries before/after screenshots** (frames for
  animations), desktop and phone, in a `## Screenshots` section — tooling in `scripts/pr-media/`.
- Update `CLAUDE.md` (milestone notes, wrinkles) and `DESIGN.md` (decisions and trade-offs, in its
  existing register) in the same PR when the work changes either.
- CI sequence must pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`.
- Free hosting is a hard requirement (Cloudflare free plan). Any new storage or service must fit in
  it — D1 and Durable Object storage do; anything billed does not.

---

## Phase A — make every situation visible

### ~~1. Scenario library and autoplay viewer~~ (#27)

**Goal.** Watch any game situation — ordinary and edge case — play itself out in the real table UI
without a human playing, and run the same scenarios headlessly in CI, so that every later change can
be checked against all of them at once.

**Scope.**
- A library of named scenarios, each `{ name, description, config, setup, actions }`, where `setup`
  is either a seed or a hand-built starting `GameState` (for edge cases a random deal will never
  produce) and `actions` is a scripted sequence. Lives in engine-adjacent code so it is pure and
  testable; a scenario that stops replaying cleanly fails CI.
- Initial scenarios, at minimum: ordinary turns (draw, meld, discard); getting down at each round
  minimum, including with book bonuses; taking the pile (natural pair, pair plus wild, extending a
  meld) and the pile obligation; red threes (both on the deal and drawn) and black threes, including a
  black-three meld going out; the Marva rule waiving the minimum; picking up the foot with and without
  a discard; a wild placed and taken back; shedding every card without going out and the cardless
  player digging back in; going out and the final lap; stock exhaustion and reshuffle; Grabby Pants
  being earned and changing hands; multi-round progression and match end.
- A **dev-only** client route (for example `/scenarios`, excluded or gated in production builds)
  that drives the real `Table` components from a local engine with no server. It must render
  through the same view projection a seat would receive, and should be able to switch which seat is
  watched (or show all hands — it is a dev tool). Playback controls:
  - play / pause, step forward **and backward** one action, and adjustable speed including fast
    forward (several times normal, plus an instant "skip animations" mode);
  - a **timeline scrubber** across the whole scenario, with jumps to the start or end of any turn or
    round;
  - **named moments**: each scenario marks the points that matter ("Marva get-down", "pile taken
    with a wild", "foot picked up", "goes out") as labelled markers on the timeline, with a jump to
    each and next/previous-moment buttons; generic events (pile taken, foot picked up, round ended,
    Grabby Pants changes hands) are marked automatically even when the scenario does not name them;
  - a deep link to a scenario at a given action or moment (e.g. `/scenarios/marva#moment=getdown`),
    so a PR description or bug report can point straight at the situation;
  - "run all" to cycle through every scenario unattended, optionally playing only a window around
    each named moment.

  **Build the player as a reusable component, not a scenario-only tool** — item 5's match replay is
  meant to be little more than a new data source plugged into it. Concretely: separate a generic
  *playback* layer (timeline of actions, seeking, speed, moments, rendering through the real table
  components) from the *source* that feeds it. A scenario and a recorded match should both reduce to
  the same input — `{ config, setup (seed or state), actions, seats/names, moments? }` — and the
  automatic moment detection should run on any such input, not just scenarios. Keep scenario-only
  concerns (the library, the dev route, "run all") outside the player, and keep the player free of
  dev-only assumptions so it can ship to production later (only the `/scenarios` route is gated).
  Choose which seat's view to render as a player option rather than hard-coding "show all hands",
  since replay will want both.

  Seeking is cheap because the engine is a pure reducer: rebuild the state at action *n* by
  replaying from the setup (or from cached checkpoints), and play animations and sounds only for
  steps actually played forward at normal speed — never for a jump. Overlays such as the Grabby Pants
  and Marva announcements should fire when playback passes their moment, not when a seek lands past
  it.
- Server-derived features (Grabby Pants, and the Marva announcement in item 2) must show in the
  viewer too. Prefer moving their derivation somewhere pure that both the server and the viewer call
  over faking it in the client.

**Done when.** Every listed scenario runs in CI headlessly and plays visually end to end in the viewer
without input; you can fast forward, scrub, step backward, and jump straight to any named moment or
deep-link to one; adding a new scenario (and its moments) is one entry in the library; and the player
takes any `{ config, setup, actions }` input, so playing a recorded game log through it needs no
changes to the player itself (prove this with a test that feeds it a golden game from
`replay.test.ts`). Document how to add one in
`CLAUDE.md`.

### ~~2. Marva rule on in both presets, and the Marva Rule celebration~~ (#28)

**Depends on** 1 (so the celebration can be shown and verified).

**Rule change.** The Marva rule applies in **both** East Coast and West Coast rulesets: set
`marvaRule: true` in `EAST_COAST` (West Coast inherits it). Update the shared test that pins it, any
engine/replay tests whose expectations change, and the preset descriptions in `DESIGN.md`/the UI. The
popup must appear in **any** ruleset where the Marva rule is on and actually used — not keyed to a
preset name — so it keeps working once item 6 allows custom rules. Confirm that existing persisted
tables still restore (the change only loosens a rule, so every logged action should remain legal, but
verify rather than assume).

**Celebration.** When a player gets down under the Marva rule (the minimum was waived because the play
emptied their hand), every player at the table sees a full-screen announcement in the style of the
Grabby Pants one:
- Large "Marva Rule" text, with confetti and celebratory party-horn imagery (as in 🎉 / 🥳) behind it.
- A deep voice says "Marva Rule" (the Grabby Pants speech approach at its lowest pitch is the
  precedent), **followed by** a DJ air-horn sound effect.
- Respects mute and reduced motion (no confetti animation for reduced-motion users; still announce).
- For the air horn, use whichever recording sounds best — a classic DJ air-horn sample is fine.
  This is a personal, non-commercial family site, so licensing is not a constraint here; pick for
  sound, not provenance.

**Implementation is the agent's choice**, with these constraints: the "Marva was used" fact must be
decided by the engine's rule (not a client guess), must reach every seat (it is public — the meld is
on the table), and must be visible in the scenario viewer. Strongly consider extracting the Grabby
Pants announcement into a reusable celebration overlay that both use, since later items (awards,
tutorial) will want it too.

**Done when.** A Marva scenario in the viewer shows the celebration with voice and horn; tests cover
the trigger (fires exactly when the waiver was used, not on an ordinary get-down or with the rule off).

---

## Phase B — social feel

### ~~3. Quick reactions~~ (#29)

Clash Royale–style reactions: a small fixed set of emojis and pre-set phrases ("Nice!", "Oops",
"Hurry up!", "Grabby!", "Well played", …) any seated player can send; they appear briefly by the
sender's seat on every screen, with an optional short sound.

- Ephemeral: relayed by the table to everyone, **not** written to the action log and not part of the
  game state. Survives hibernation trivially because it is never stored.
- Server-side rate limit per seat; client-side cooldown so spamming is not possible.
- Only ids from a fixed list cross the wire — never free text — so there is nothing to moderate.
- A per-device "mute reactions" toggle.
- Works on phone (reaction picker as a bottom sheet, matching the card menu).

### 4. Identity and avatars *(may split: 4a identity, 4b avatars)*

*4a (identity) done in #30; 4b (avatars) next. The store ended up as a Durable Object per identity
rather than D1 — see DESIGN.md, "Identity without accounts".*

A lightweight notion of a **user** without accounts or passwords.

- An anonymous device identity: a random user id plus a secret, created on first visit, kept in
  `localStorage`, and registered with a server-side store (D1 is the expected fit on the free plan;
  the Node host needs an equivalent for local play). It can be upgraded to a real account later
  (item 15) without migrating data.
- The player's name is **remembered** and pre-filled, but can still be changed at any time (per table
  or permanently).
- Small profile pictures as **semi-custom avatars**: built from a preset set of parts or icons plus
  colours, rendered as SVG, so there are no image uploads to store or moderate. Shown on seats, the
  opponent strip, the lobby, and reactions.
- Seats carry the user id so later items can attribute games and stats. Seat tokens stay the
  authority for *acting* at a table; the user id is identity, not authorization — don't let one
  substitute for the other.
- Handle the "cleared storage / new device" case gracefully (a fresh identity, no error). A way to
  move an identity to another device (a short code or link) is a nice-to-have, not required.

### 5. Match history, stats, and replay *(may split: 5a history + stats, 5b replay viewer)*

**Depends on** 4.

- When a match ends (or a table closes mid-match), persist a record: config, seed, seats with user
  ids and names, the action log, per-round scores, and outcome. The log is a few KB, so storing it whole
  is the design — replay reconstructs everything else.
- The home screen shows the user's stats (games played, wins, average score, best round, times as
  Grabby Pants, Marva Rules invoked, …) and a list of recent matches.
- **Replay**: open any past match in the item 1 player, which was built for this — the work here is
  loading a stored match into its `{ config, setup, actions }` input and adding a production route, not
  building playback. All of its controls come for free: fast forward, scrubbing, step back, jump to a
  turn or round, and the automatic moments (pile takes, foot pickups, Marva, Grabby Pants, going out).
  Because the match is over, replay may show every hand or follow one seat. If something about
  playback has to change for replay, change it in the shared player, not in a fork.
- Decide and document retention (keep everything is fine at this scale) and what an unfinished,
  closed match shows.

---

## Phase C — rules, bots, and learning to play

### 6. Rules editor in the main menu

Expose the config-driven engine when opening a table: time per turn (base, increment, cap, discard
grace), lay-down minimums per round, number of rounds, wild ratio, Marva rule, go-out book
requirements, hand/foot size, extra decks, initial discard flip, stock exhaustion, scoring values,
pause allowed. Start from a preset and edit.

- Validate on the server, not just in the form. `DESIGN.md` explains why room options are currently
  a small set of unions; this item replaces that with a validated partial config, so update that
  section to record the new trade-off.
- The lobby shows every player the table's rules and highlights anything changed from the preset.
- Persist the full config with the room record so restore replays under the same rules.
- Remember the user's last custom rules (per identity once item 4 exists).

### 7. Heuristic bot and bot-filled seats *(may split: 7a policy, 7b seats)*

- A playing heuristic beside `defaultAction` in `policy.ts`, reusing `chooseDiscard` and `plan.ts`:
  it draws or takes the pile sensibly, gets down when it can, builds toward books, and goes out. Pure
  and deterministic given state (plus an injected rng if it randomizes). This is also the RL
  agent's evaluation baseline — `defaultAction` is not, since it never melds.
- Measure it headlessly: win rate against `defaultAction` and against itself over many seeded games,
  and that bot-only games end rounds (unlike default-only games). A small script that reports this is
  part of the PR.
- The host can add bot seats in the lobby (named, with avatars), so a person can play solo or fill
  a short table. Bots act on a short realistic delay, through the same action path as players.
- Consider letting a bot take over a disconnected seat instead of `defaultAction` — it would end the
  "a table of defaults never ends a round" problem — but that changes table-lifetime behaviour
  documented in `DESIGN.md`, so make it a deliberate, documented choice.

### 8. Rules page

A readable "How to play" page reachable from the home screen and from the table (a modal there): the
objective, the deal, a turn, melds and books (clean/dirty), wilds and the wild ratio, red and black
threes, taking the pile, getting down and the minimums, the Marva rule, the foot, going out, and
scoring. It should read the **actual config** where it matters, so a table's rules page shows that
table's minimums, wild ratio, and Marva setting rather than generic text.

### 9. Hints and interactive tutorial *(may split: 9a in-game hints, 9b tutorial)*

**Depends on** 1 (scenarios) and 7 (the bot as a source of suggestions).

- **In-game hints** (toggleable, off by default at competitive tables): explain why a button is
  disabled ("you need 90 points to get down; staged: 65"), and an optional "suggest a move" that asks
  the heuristic bot what it would do from the player's own view only.
- **Tutorial**: guided scenarios built on the item 1 library — scripted deals where the learner is
  asked to make a specific move, with explanation, covering one concept each (draw and discard, melds,
  getting down, taking the pile, wilds, threes, the foot, going out). Progress remembered per identity.
- A "demo game" mode: watch bots play a full round with narration of what each move did and why.

---

## Phase D — polish and reach

### 10. Your-turn attention

Family games often sit in a background tab. Flash the tab title and favicon on your turn, an optional
browser notification, and installability as a PWA (manifest, icons). Web push for "your turn" while
the page is closed is a follow-up only if it fits the free plan.

### 11. Round recap and match awards

At round end, a short recap (who went out, books made, biggest swing). At match end, awards built on
the celebration overlay: most Grabby Pants, Marva Rules invoked, most clean books, most red threes
eaten, and similar. Feed the counts into item 5's stats.

### 12. Rematch and spectators

- One-tap rematch with the same seats and rules (building on the existing play-again flow).
- A read-only watch link for people not playing. A spectator sees only public information during the
  match — this is a new view projection and needs its own `view.test.ts` guarantees.

### 13. Browser end-to-end tests in CI

Playwright, driving the item 1 scenarios through the real client and comparing screenshots, so a UI
regression in any situation fails CI. Reuse the existing `scripts/pr-media/` harness setup. Keep it
fast enough to run on every PR, or split a quick smoke set from a nightly full run.

### 14. Accessibility and cosmetics

Four-colour deck option (colour-blind friendly), card-back and table themes (cheap avatar-style
customization), a reduced-motion and screen-reader pass over the table, and larger-text support on
phones.

### 15. Operations: error reporting, moderation, accounts

- Client and Worker error reporting within the free plan (a minimal logging endpoint is fine).
- Name filtering and per-identity rate limits now that identities exist.
- Optional real accounts (sign-in) that an anonymous identity upgrades into, for using the same
  profile across devices. Only if wanted — the anonymous identity may be enough for one family.

---

## Phase E — the point of the project

### 16. Reinforcement-learning agent

**Depends on** 7 (the evaluation baseline) and benefits from 5 (recorded human games).

Write the design into `DESIGN.md`'s placeholder section first, as its own PR: state and action
representation from `PlayerView`, handling imperfect information, the self-play regime, reward design,
and evaluation against random, `defaultAction`, the heuristic bot, and humans. Then implement in
follow-up PRs: a headless environment wrapper, training, and serving the trained agent as a seat
option beside the heuristic bot. Recorded games for imitation learning must exclude forced moves
(`LoggedAction.source`).
