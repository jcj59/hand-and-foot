# The Hand and Foot server, for Fly.io.
#
# The libraries are consumed from source and have no build step, so the image is
# the workspace's server-side packages plus their production dependencies, run by
# tsx. The client is not in it: Vercel builds and serves that separately.

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
# Every workspace manifest, so pnpm can resolve the lockfile; the client's is
# needed for that alone, and none of its dependencies are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile --prod --filter @hf/server...

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/engine/src packages/engine/src
COPY packages/engine/tsconfig.json packages/engine/
COPY packages/server/src packages/server/src
COPY packages/server/tsconfig.json packages/server/
WORKDIR /app/packages/server
USER node
EXPOSE 8080
ENV PORT=8080
# Node itself is the process, with tsx loaded as a hook — not `pnpm start`, whose
# wrapper does not forward SIGTERM, and not the `tsx` CLI, which runs the server
# as a child. The server must be the one to hear the host's SIGTERM, so that it
# stops its clocks and writes out what the database is still owed.
CMD ["node", "--import", "tsx", "src/main.ts"]
