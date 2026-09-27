# Hand and Foot

An online multiplayer implementation of Hand and Foot, a family card game. The goal is a table
played in the browser with friends via room codes, and, beyond that, a reinforcement-learning agent
trained by self-play that beats human opponents. See [DESIGN.md](DESIGN.md) for the architecture,
the design decisions, and the direction for the agent.

## Status

The game is not yet playable end to end: the browser client can open or join a table and wait at
it, but there is no game table yet.

- **Rules engine** (`packages/engine`) — complete and fully tested.
- **Server** (`packages/server`) — complete and fully tested: the authoritative real-time
  Socket.io server, with rooms, per-player filtered views, turn clock, and disconnect handling.
- **Browser client** (`packages/client`) — in progress: the application shell, the connection
  and session layer, server-time anchoring, and the lobby (open or join a table by code or shared
  link, wait for players, host deals) are done; the table and meld staging follow.
- Persistence and deployment follow the client; the agent comes after that.

## Running the server locally

```bash
pnpm install
pnpm --filter @hf/server start    # or `dev` to restart on change
```

`PORT` defaults to 3000. The operational settings are `HF_CORS_ORIGINS`, `HF_RECONNECT_GRACE_MS`,
and `HF_ABANDONED_ROOM_MS`; see [`packages/server/src/env.ts`](packages/server/src/env.ts) for their
defaults and formats. A value the server cannot parse stops it at startup.

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
