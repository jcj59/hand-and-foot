import type { TableObject } from "./table";

/** What wrangler.jsonc binds for the Worker. */
export interface Env {
  readonly TABLES: DurableObjectNamespace<TableObject>;
  readonly ASSETS: Fetcher;
}
