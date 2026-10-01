import type { TableObject } from "./table";
import type { UserObject } from "./users";

/** What wrangler.jsonc binds for the Worker. */
export interface Env {
  readonly TABLES: DurableObjectNamespace<TableObject>;
  /** One object per identity, addressed by its user id. */
  readonly USERS: DurableObjectNamespace<UserObject>;
  readonly ASSETS: Fetcher;
}
