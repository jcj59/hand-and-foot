# Hand and Foot

An online multiplayer implementation of Hand and Foot, a family card game. The goal is a table
played in the browser with friends via room codes, and, beyond that, a reinforcement-learning agent
trained by self-play that beats human opponents. See [DESIGN.md](DESIGN.md) for the architecture,
the design decisions, and the direction for the agent.

## Status

The game is not yet playable end to end: there is no browser client.

- **Rules engine** (`packages/engine`) — complete and fully tested.
- **Server** (`packages/server`) — complete and fully tested: the authoritative real-time
  Socket.io server, with rooms, per-player filtered views, turn clock, and disconnect handling.
- **Browser client** (`packages/client`) — the next milestone.
- Persistence and deployment follow the client; the agent comes after that.

## Running the server locally

```bash
pnpm install
pnpm --filter @hf/server start    # or `dev` to restart on change
```

`PORT` defaults to 3000. The operational settings are `HF_CORS_ORIGINS`, `HF_RECONNECT_GRACE_MS`,
and `HF_ABANDONED_ROOM_MS`; see [`packages/server/src/env.ts`](packages/server/src/env.ts) for their
defaults and formats. A value the server cannot parse stops it at startup.

## Development

The repository is a pnpm and Turborepo monorepo in TypeScript. From the root, these are the checks
CI runs:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```
