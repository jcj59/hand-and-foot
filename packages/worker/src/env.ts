import type { TableObject } from "./table";
import type { UserObject } from "./users";
import type { LoginObject } from "./logins";
import type { ReportsObject } from "./reports";

/** What wrangler.jsonc binds for the Worker. */
export interface Env {
  readonly TABLES: DurableObjectNamespace<TableObject>;
  /** One object per identity, addressed by its user id. */
  readonly USERS: DurableObjectNamespace<UserObject>;
  /** One object per username, addressed by its lower-case form. */
  readonly LOGINS: DurableObjectNamespace<LoginObject>;
  /** Players' bug reports, all in the one object named `REPORTS_OBJECT`. */
  readonly REPORTS: DurableObjectNamespace<ReportsObject>;
  /**
   * The token that reads the reports back (`wrangler secret put REPORTS_TOKEN`).
   * Unset, reading them is not offered at all.
   */
  readonly REPORTS_TOKEN?: string;
  readonly ASSETS: Fetcher;
}
