# Hand and Foot

An online multiplayer implementation of Hand and Foot, a family card game. The goal is a table
played in the browser with friends via room codes, and, beyond that, a reinforcement-learning agent
trained by self-play that beats human opponents. See [DESIGN.md](DESIGN.md) for the architecture,
the design decisions, and the direction for the agent.

## Status

The game is playable end to end in the browser: open or join a table by room code, deal, and play
a four-round match through to its final totals.

- **Rules engine** (`packages/engine`) — complete and fully tested.
- **Server** (`packages/server`) — complete and fully tested: the authoritative table logic, with
  rooms, per-player filtered views, turn clock, and disconnect handling, plus a Node host for it.
- **Browser client** (`packages/client`) — complete: the lobby (open or join a table by code or
  shared link, wait for players, host deals) and the table (hand, opponents, melds, piles, turn
  clock), with melds staged locally against the lay-down minimum before they are committed, the
  cards owed after taking the pile marked, and the discard.
- **Hosting** (`packages/worker`) — the whole game is one Cloudflare Worker on the free plan, with
  each table a Durable Object that keeps its record and action log in its own storage and is
  rebuilt from them after a restart, so a deploy does not end the games in progress. The agent
  comes next.

## Running it locally

The quickest way to play is the Worker itself, run locally by Wrangler. It builds the client and
serves both on one port:

```bash
pnpm install
pnpm --filter @hf/worker dev      # http://localhost:8787
```

To work on the client with hot reload, run a server and Vite side by side. Vite proxies `/api` to
the Node server on :3000 by default:

```bash
pnpm --filter @hf/server dev      # the Node server on :3000
pnpm --filter @hf/client dev      # Vite on http://localhost:5173
```

or to the Worker, with `HF_API_TARGET=http://localhost:8787 pnpm --filter @hf/client dev`.

The Node server's settings are `PORT` (default 3000), `HF_CORS_ORIGINS`, `HF_RECONNECT_GRACE_MS`,
`HF_ABANDONED_ROOM_MS`, and `DATABASE_URL` to keep rooms in Postgres across restarts (without it
they live in memory only); see [`packages/server/src/env.ts`](packages/server/src/env.ts) for
their defaults and formats. A value the server cannot parse stops it at startup.

## Development

The repository is a pnpm and Turborepo monorepo in TypeScript. From the root, these are the checks
CI runs:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

The database tests — the store, its migrations, and a full restart over real sockets — run when
`HF_TEST_DATABASE_URL` names a Postgres database the suite may create databases beside and wipe,
and are skipped otherwise. CI runs them against a Postgres service.

## Deploying

Everything deploys as one Cloudflare Worker, on the free plan. One-time setup:

1. **Account.** Create a free Cloudflare account, then log in from this machine:

   ```bash
   pnpm --filter @hf/worker exec wrangler login
   ```

2. **Deploy.** Build the client and deploy it with the Worker:

   ```bash
   pnpm --filter @hf/worker run deploy
   ```

   Wrangler prints the address, `https://hand-and-foot.<your-subdomain>.workers.dev`. That is the
   game: share it, or a table's link, with the other players.

3. **Continuous deployment** (optional). Add two secrets to the GitHub repository:
   `CLOUDFLARE_ACCOUNT_ID` (shown on the Cloudflare dashboard) and `CLOUDFLARE_API_TOKEN` (create
   one from the "Edit Cloudflare Workers" template). Every push to `main` that passes CI then
   deploys. Until they exist the deploy workflow does nothing.
