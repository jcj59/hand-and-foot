import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The tests run inside the Workers runtime (workerd, through Miniflare) with the
// real Durable Object bindings from wrangler.jsonc, so what they exercise is what
// Cloudflare runs.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
