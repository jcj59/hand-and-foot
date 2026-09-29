import type { Env as WorkerEnv } from "../src/env";

// The bindings wrangler.jsonc gives the Worker, as `env` from cloudflare:test sees them.
declare global {
  namespace Cloudflare {
    // An empty interface is the point: it merges the Worker's bindings into this one.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends WorkerEnv {}
  }
}
