/**
 * One identity, as a Durable Object addressed by its user id.
 *
 * An object per user rather than one database for everyone: there is never a
 * question that reads across identities, so nothing is lost by keeping each apart,
 * and an object's storage is part of the free plan where a separate database would
 * be one more thing to create and bind. The rules — what an identity is, how its
 * secret is checked — are the server's own (`users.ts`), as for tables.
 */
import { DurableObject } from "cloudflare:workers";
import { registerUser, verifyUser, type UserRecord, type UserStore } from "@hf/server/core";
import type { Env } from "./env";

const RECORD = "user";

export class UserObject extends DurableObject<Env> {
  /** This object's one record, through the store interface the rules are written against. */
  private readonly store: UserStore = {
    get: async (userId) => {
      const record = this.ctx.storage.kv.get<UserRecord>(RECORD);
      return record?.userId === userId ? record : null;
    },
    // One object per identity, and an object handles one request at a time, so the
    // check and the write below cannot be interleaved with another registration.
    put: async (record) => {
      const held = this.ctx.storage.kv.get<UserRecord>(RECORD);
      if (held && held.secretHash !== record.secretHash) return false;
      this.ctx.storage.kv.put(RECORD, record);
      return true;
    },
  };

  register(body: unknown, now: number): ReturnType<typeof registerUser> {
    return registerUser(this.store, body, now);
  }

  verify(credentials: unknown): Promise<string | null> {
    return verifyUser(this.store, credentials);
  }
}
