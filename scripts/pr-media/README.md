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

   Arguments: `<out.png> <width> <height> <action> <mode>`. Modes stage a state
   (`mine`, `theirs`) or a change to capture mid-animation (`draw`, `discard`,
   `oppdraw`, `grabby`), with `FRAMES=40,120,300` giving the milliseconds after the
   change to capture. `BIG_MELDS=1` adds enough melds that the middle scrolls.
   On this machine Chromium needs nss/nspr/alsa from the `pwlibs` conda env.

   For "before" shots, build and render the base branch first.

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
