import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
// From vitest rather than vite: the `test` block below is vitest's, and vite's own
// `defineConfig` does not know about it.
import { defineConfig } from "vitest/config";

/**
 * The client is the first package in the repo that needs a real build: the
 * engine, shared types and server are all consumed from source. `pnpm build`
 * was a no-op until now.
 *
 * The client always talks to its own origin, because in production one Worker
 * serves both the page and the API. In development the dev server makes that
 * true too by proxying `/api` — HTTP and the table sockets — to a running
 * server: the Node server on :3000 by default, or `HF_API_TARGET` for another,
 * such as `wrangler dev` on :8787.
 */
const apiTarget = process.env.HF_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": { target: apiTarget, ws: true } } },
  test: {
    // Components are asserted through the real DOM. The pure modules — the
    // server-clock anchoring, the staging logic — do not need it, but one
    // environment for the package keeps the config to a single line.
    environment: "jsdom",
    // No `globals`: every other package in the repo imports `describe`/`it`/
    // `expect` from vitest explicitly, and the setup file unmounts between tests
    // rather than relying on a global `afterEach` being in scope.
    setupFiles: ["./src/test-setup.ts"],
  },
});
