import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The tests run inside the Workers runtime (workerd, through Miniflare) with the
// real Durable Object bindings from wrangler.jsonc, so what they exercise is what
// Cloudflare runs.
// `REPORTS_TOKEN` is a secret in production, so not in wrangler.jsonc; the tests
// set one so that reading the reports back can be exercised.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { REPORTS_TOKEN: "test-reports-token" } },
    }),
  ],
});
