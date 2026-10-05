import type { TableObject } from "./table";
import type { UserObject } from "./users";
import type { LoginObject } from "./logins";

/** What wrangler.jsonc binds for the Worker. */
export interface Env {
  readonly TABLES: DurableObjectNamespace<TableObject>;
  /** One object per identity, addressed by its user id. */
  readonly USERS: DurableObjectNamespace<UserObject>;
  /** One object per username, addressed by its lower-case form. */
  readonly LOGINS: DurableObjectNamespace<LoginObject>;
  readonly ASSETS: Fetcher;
}
