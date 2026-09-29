# Hand and Foot

An online multiplayer implementation of Hand and Foot, a family card game. The goal is a table
played in the browser with friends via room codes, and, beyond that, a reinforcement-learning agent
trained by self-play that beats human opponents. See [DESIGN.md](DESIGN.md) for the architecture,
the design decisions, and the direction for the agent.

## Status

The game is playable end to end in the browser: open or join a table by room code, deal, and play
a four-round match through to its final totals.

- **Rules engine** (`packages/engine`) — complete and fully tested.
- **Server** (`packages/server`) — complete and fully tested: the authoritative real-time
  Socket.io server, with rooms, per-player filtered views, turn clock, and disconnect handling.
- **Browser client** (`packages/client`) — complete: the lobby (open or join a table by code or
  shared link, wait for players, host deals) and the table (hand, opponents, melds, piles, turn
  clock), with melds staged locally against the lay-down minimum before they are committed, the
  cards owed after taking the pile marked, and the discard.
- **Persistence and deployment** — rooms are kept in Postgres and rebuilt by replaying their
  action logs after a restart, so a deploy does not end the games in progress. The server ships as
  a container for Fly.io and the client as a static build for Vercel. The agent comes next.

## Running the server locally

```bash
pnpm install
pnpm --filter @hf/server start    # or `dev` to restart on change
```

`PORT` defaults to 3000. The operational settings are `HF_CORS_ORIGINS`, `HF_RECONNECT_GRACE_MS`,
and `HF_ABANDONED_ROOM_MS`, plus `DATABASE_URL` to keep rooms in Postgres across restarts (without
it they live in memory only); see [`packages/server/src/env.ts`](packages/server/src/env.ts) for
their defaults and formats. A value the server cannot parse stops it at startup.

With the server running, start the client in a second terminal:

```bash
pnpm --filter @hf/client dev      # Vite on http://localhost:5173
```

`VITE_SERVER_URL` points it at the server and defaults to `http://localhost:3000`. The two run on
separate origins, as they do when deployed, so set `HF_CORS_ORIGINS=http://localhost:5173` on the
server to exercise CORS strictly.

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

The server runs on Fly.io as a single always-on machine, the client on Vercel, and the database on
Neon. One-time setup:

1. **Database.** Create a Neon project and copy its connection string (with `sslmode=require`).
   The server creates its tables on first boot.
2. **Server.** With `flyctl` logged in, create the app once, point it at the database, and deploy:

   ```bash
   fly apps create hand-and-foot          # or another name; match `app` in fly.toml
   fly secrets set DATABASE_URL='postgresql://…' HF_CORS_ORIGINS='https://<client>.vercel.app'
   fly deploy --ha=false
   ```

   It must stay at **one machine** (`--ha=false`): every room lives in that one process, so a
   second machine would be a second, disjoint set of tables. The deploy strategy is `rolling`, which
   stops the old machine before the new one starts; the old one writes out its last moves on
   SIGTERM and the new one restores every open room before accepting players.
3. **Client.** Import the repository into Vercel (it reads `vercel.json`; no framework preset) and
   set `VITE_SERVER_URL` to the server's URL, e.g. `https://hand-and-foot.fly.dev`.
4. **Continuous deployment.** Add a `FLY_API_TOKEN` secret to the GitHub repository
   (`fly tokens create deploy`), and every push to `main` that passes CI deploys the server. Vercel
   deploys the client from `main` on its own.
