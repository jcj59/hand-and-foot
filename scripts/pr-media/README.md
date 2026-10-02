# PR screenshots

Every PR that changes what players see gets before/after screenshots (or frames of
an animation) in its description, under `## Screenshots`.

1. **Render.** `scene.mjs` loads the built client from a running `wrangler dev`
   (`pnpm --filter @hf/worker dev`, :8787) in headless Chromium, with the table's
   socket answered by a mock, so any game state can be staged:

   ```bash
   pnpm --filter @hf/client build          # wrangler dev serves this build
   cd /tmp/pw && npm i playwright@1.63.0   # once; `npx playwright install chromium` too
   cp ~/dev/hand-and-foot/scripts/pr-media/scene.mjs . && \
     LD_LIBRARY_PATH=~/miniconda3/envs/pwlibs/lib node scene.mjs out.png 390 844 none mine
   ```

   Arguments: `<out.png> <width> <height> <action> <mode>`. Actions include `picker`, which opens
   the reaction picker. Modes stage a state
   (`mine`, `theirs`) or a change to capture mid-animation (`draw`, `discard`,
   `oppdraw`, `grabby`, `react` — quick reactions arriving from two opponents and
   the viewer — and `stale` — a finished round at one table, then a fresh
   deal at another), with `FRAMES=40,120,300` giving the milliseconds after the
   change to capture. `BIG_MELDS=1` adds enough melds that the middle scrolls;
   `GRABBY_ME=1` makes the viewer the Grabby Pants holder; `TWO_DISCARDS=1` puts two
   cards on the discard pile, `PILE=<n>` puts n; mode `takepile` has the viewer take the pile; `BIG_OPP=1` gives an opponent enough melds to fill its box;
   `BLACK_BOOK=1` puts the viewer in their foot beside a book of black threes, holding a red
   three and a black one. `PAUSED=1` has Ana pause the table, `SAVED=1` has her save it for later
   (three players back; the viewer hosts unless `SAVED_GUEST=1`), and `ROUND_OVER=1` opens the
   scoreboard between rounds. Action `home` renders the home screen instead of the table, with
   `SAVED_LIST=1` seeding two saved games.
   On this machine Chromium needs nss/nspr/alsa from the `pwlibs` conda env. Emoji (the quick
   reactions) draw as boxes without a colour emoji font: set `EMOJI_FONT=<path to
   NotoColorEmoji.ttf>` and the page loads it for emoji only. Do not install it system-wide —
   fontconfig then hands it digits and spaces too, and every number on the table spreads out.
   Its range also covers the suit symbols, so cards draw emoji suits: set it only for shots of
   reactions. `BASE=<url>` points the harness at another origin, such as `vite` dev on :5173
   (which needs no build).

   For "before" shots, build and render the base branch first.

   To shoot a real game rather than a mocked state, build with
   `VITE_SCENARIOS=1 pnpm --filter @hf/client build`: that build also serves the
   dev-only scenario viewer at `/scenarios/<id>#moment=<id>` (or `#step=n&seat=n`),
   which plays any scenario on the real table with no server.

2. **Upload.** Convert to JPEG at half size (`ffmpeg -i x.png -vf scale=iw/2:-1
   -q:v 4 x.jpg`), then push them to the `pr-media` branch through the GitHub API —
   never to `main`, and not with `git push` (the no-mistakes gate owns pushes):

   ```bash
   GH_TOKEN=$(gh auth token) python3 scripts/pr-media/upload_media.py <dir> pr-<number>
   ```

3. **Describe.** Write the section as markdown (images from
   `https://raw.githubusercontent.com/jcj59/hand-and-foot/pr-media/pr-<number>/…`)
   and put it into the PR body, just after the intent:

   ```bash
   GH_TOKEN=$(gh auth token) python3 scripts/pr-media/pr_media_section.py <number> section.md
   ```
