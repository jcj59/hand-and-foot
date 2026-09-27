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
 * The dev server proxies nothing — the client talks to the server over a socket
 * on its own origin, given by `VITE_SERVER_URL` and defaulting to the server's
 * own default port. Keeping them separate origins in development is deliberate,
 * because that is how they are deployed (Vercel and Fly.io), so CORS is
 * exercised locally rather than discovered in production.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
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
