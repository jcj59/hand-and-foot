/**
 * One username, as a Durable Object addressed by its lower-case form.
 *
 * Signing in is the one lookup that is not by user id, so it needs a place of its
 * own; an object per username keeps to the rule that nothing reads across players,
 * and makes "is this name taken" a question one object answers alone. The rules
 * are the server's (`accounts.ts`); this is only where the record is kept.
 */
import { DurableObject } from "cloudflare:workers";
import { follows, type LoginRecord } from "@hf/server/core";
import type { Env } from "./env";

const RECORD = "login";

export class LoginObject extends DurableObject<Env> {
  load(key: string): LoginRecord | null {
    const record = this.ctx.storage.kv.get<LoginRecord>(RECORD);
    return record?.key === key ? record : null;
  }

  /** Write if it follows the stored record; synchronous, so nothing comes between. */
  save(record: LoginRecord): boolean {
    if (!follows(record, this.load(record.key))) return false;
    this.ctx.storage.kv.put(RECORD, record);
    return true;
  }

  /** Give the username back, if it still leads to this identity. */
  release(key: string, userId: string): void {
    if (this.load(key)?.userId === userId) this.ctx.storage.kv.delete(RECORD);
  }
}
