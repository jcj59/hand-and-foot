/**
 * Where finished matches are kept, and what a player is told about theirs.
 *
 * A match is kept for each person who played it under an identity; one played
 * entirely anonymously is not kept, since nobody could ever ask for it. The record
 * carries the whole action log, which is a few kilobytes and is what the replay
 * plays — see `MatchRecord`. Everything is kept: at the scale of one family there
 * is no reason to throw a game away, and a recorded game is a training example
 * for the agent.
 */
import {
  historyFor,
  isUserCredentials,
  NOT_AN_IDENTITY,
  type Ack,
  type MatchHistory,
  type MatchRecord,
} from "@hf/shared";
import { verifyUser, type UserStore } from "./users";

export interface MatchStore {
  /** Keep a match, or replace the copy kept under the same id. */
  save(record: MatchRecord): Promise<void>;
  /** Every match kept for this identity. */
  forUser(userId: string): Promise<readonly MatchRecord[]>;
}

/** The identities a match is kept for: the people who played it, never a computer. */
export function keptFor(record: MatchRecord): string[] {
  return record.seats.flatMap((s) => (s.userId && !s.bot ? [s.userId] : []));
}

export class InMemoryMatchStore implements MatchStore {
  private readonly records = new Map<string, MatchRecord>();

  async save(record: MatchRecord): Promise<void> {
    // Through JSON, as into the database, so nothing is kept that would not survive it.
    this.records.set(record.id, JSON.parse(JSON.stringify(record)) as MatchRecord);
  }

  async forUser(userId: string): Promise<readonly MatchRecord[]> {
    return [...this.records.values()].filter((r) => keptFor(r).includes(userId));
  }
}

/**
 * A player's history, for the identity the body's `user` proves. An identity that
 * does not check out is refused, rather than answered with an empty history that
 * would read as a player who has never finished a game.
 */
export async function matchHistory(
  users: UserStore,
  matches: MatchStore,
  body: unknown,
): Promise<Ack<MatchHistory>> {
  const user = (body as { user?: unknown } | null)?.user;
  if (!isUserCredentials(user)) return { ok: false, error: NOT_AN_IDENTITY };
  const userId = await verifyUser(users, user);
  if (userId === null) return { ok: false, error: NOT_AN_IDENTITY };
  return { ok: true, data: historyFor(await matches.forUser(userId), userId) };
}
