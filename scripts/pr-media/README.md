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
   the reaction picker, `rules`, which opens the
   table's How to play dialog, `menu` (the table's menu), `scores` (the phone's scores sheet),
   `expand` (a seat's melds on a computer), `chip` (a phone chip's melds sheet; both pick
   Cyrus, or `SEAT=<name>`), `card` (a
   card's choices; `CARD=<name>` picks the card, the Ten of hearts by default), `meld` (a
   lay-down being built), `wildbook` (the Two of hearts staged onto the dirty book of 9s, or the
   clean Ks with `BOOK=K`) and `hidescores` (the computer's side panel put away, or brought back
   with `HIDE_SCORES=1`, which starts with it put away); `LAYOUT=<json>` starts the computer table with the sizes a player
   dragged it to (as `hf.tableLayout` keeps them: `{"sideWidth":420,"footerHeight":360,"seatsHeight":null}`),
   `NAV_FOLDED=1` the app's sidebar folded to its rail, and action `drag` drags a divider
   (`DRAG_LABEL`, "Resize your hand" by default; `DRAG_BY=dx,dy`, default `0,-160`) in ten steps,
   shooting `out-0.png` before it and `out-1.png` to `out-5.png` along the way; action `arrange` drags a card
   of the player's own hand (`ARRANGE_CARD`, "Joker, wild" by default) to just before another
   (`ARRANGE_BEFORE`, "Four of hearts"), sideways first, shooting `out-0.png` to `out-5.png` and
   `out-6.png` once it is let go, and logs `animationsAfterDrop`; `COMPACT_MELDS=1` starts with the
   player's own melds collapsed to chips; `PILE_WHY=1` puts the viewer in their
   draw phase with the pile not takeable, and `TAKEABLE=1` in their draw phase with it takeable; `TOOK_PILE=1` puts them in round 1, not down,
   just after taking the pile (its cards owed), and action `laydown` presses "Lay down for me";
   `FOOT=1` puts the viewer in their foot a dirty book short of going out, with a card of a melded
   rank, a wild and a red three, and `GO_OUT=1` has the server say the books to go out are in
   place. Modes stage a state
   (`mine`, `theirs`) or a change to capture mid-animation (`draw`, `discard`,
   `oppdraw`, `grabby`, `react` (quick reactions arriving from two opponents and
   the viewer; with `EMOTE=<id>`, that one emote from Cyrus and from the viewer), `chat` (a line from Ana arriving: her bubble and one unread) and `stale` (a finished round at one table, then a fresh
   deal at another), with `FRAMES=40,120,300` giving the milliseconds after the
   change to capture, and `CLICK_AT=500,1000` the milliseconds at which to click the middle of
   the window (a frame and a click at the same time: the frame first). `BIG_MELDS=1` adds enough melds that the middle scrolls;
   `GRABBY_ME=1` makes the viewer the Grabby Pants holder; `TWO_DISCARDS=1` puts two
   cards on the discard pile, `PILE=<n>` puts n; mode `takepile` has the viewer take the pile;
   `BIG_OPP=1` gives an opponent enough melds to fill its box (clean and dirty books, and open
   melds holding a two, a joker, both, or no wild);
   `PLAYERS=<n>` seats only the first n players (2 to 6; Jack, Ana, Ben, Cyrus, Dee, Eleanor);
   `BIG_HAND=1` gives Ben 22 cards, more than a seat's fan of backs draws;
   `BLACK_BOOK=1` puts the viewer in their foot beside a book of black threes, holding a red
   three and a black one (with `DEAD_THREES=1`, a foot of 14 cards, overlapping, with red and
   black threes among them). `PAUSED=1` has Ana pause the table, `SAVED=1` has her save it for later
   (three players back; the viewer hosts unless `SAVED_GUEST=1`), and `ROUND_OVER=1` opens the
   scoreboard between rounds (with `MATCH_OVER=1`, the final one, with awards; every seat's held cards come with it, Cyrus's foot never reached; action `expandrows` opens Cyrus's and Ana's rows and `dragboard` drags the board aside by its heading); `KEPT=1` (with `MATCH_OVER=1`) makes the match one that was kept: the result names
   it (`matchId`), the viewer has an identity, so the board offers "Watch it back" (action `watchbutton` scrolls the board to it; `SHOT_AT=7000` waits out
   the awards), and with
   `REPLAY_JSON=<path to a recorded ReplayMatch>` action `watchback` opens the replay from it and
   lets it play for `PLAY_FOR` ms (4000); with `LEFT=1`, Ana has left the match after round 1 (and Dee,
   seat 4, is not at the table, so the host is offered to carry on without her). `CHAT=1` sends the table's chat history (four
   lines, the viewer's among them) on sitting down or watching, and action `chat` opens the chat
   (the side panel's tab on a computer, the header's Chat button on a phone). `BOTS=1` makes Ben and Dee
   computer players ("Robo Rita", "Robo Ray"); `LOBBY=1` renders the waiting room instead of the
   table (`LOBBY_GUEST=1`: as a guest, Ana hosting). `WATCHING=1` renders the table as a spectator sees it, at `/watch/HFDEMO`. Action `home` renders the home screen
   instead of the table, with `SAVED_LIST=1` seeding two saved games. Action `history` renders
   History with three recorded games (answered by a mock), the seat at HFDEMO still held and one
   game saved for later; with `PEOPLE=1` two more games and three more people (enough for "More"
   in Played with), `MORE=1` opens the More sheet and `PERSON=<name>` opens that person's card;
   `FILTERS=1` scrolls the filters into view.
   Action `report` opens the table menu's Report a bug sheet with a few
   words written, and `profile-report` the same sheet from Profile (signed in as "jack");
   `REPORT_SEND=1` sends it to a mock for the thanks, and `REPORT_SCROLL=1` scrolls the sheet
   to its foot. Action `profile` is Profile alone, signed in. `FULL_PAGE=1` shoots the whole page rather than the window, and
   `REDUCED_MOTION=1` renders as a player who asked for reduced motion.
   On this machine Chromium needs nss/nspr/alsa from the `pwlibs` conda env. Emoji (the quick
   reactions) draw as boxes without a colour emoji font: set `EMOJI_FONT=<path to
   NotoColorEmoji.ttf>` and the page loads it for emoji only (as a face of the page's own font
   families, limited to emoji code points: Chromium never falls back to a web font by name).
   Do not install it system-wide: fontconfig then hands it digits and spaces too, and every
   number on the table spreads out. A copy is at
   `https://github.com/googlefonts/noto-emoji/raw/v2.047/fonts/NotoColorEmoji.ttf`.
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
