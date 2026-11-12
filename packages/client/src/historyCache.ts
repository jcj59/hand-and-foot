/**
 * The player's match history, asked of the server at most once a minute.
 *
 * Home, History and Profile all show it, and every visit to one of them would
 * otherwise ask again: each ask is a request to the player's identity object, and
 * the Workers free plan allows 100,000 Durable Object requests a day for the whole
 * game. A bug that re-asks on every render once used them all up in two hours. So
 * an answer is kept for a minute, in this tab's session storage (a reload keeps it)
 * and in memory (blocked storage still keeps it), and an ask still on its way is
 * shared rather than sent again. A failed answer, the server saying "too many
 * requests" included, is kept for the minute too, so nothing retries in a loop.
 *
 * What would make the kept answer wrong is forgotten at once: signing in or out
 * (`identity.ts`), and finishing, joining or leaving a table (`session.ts`), so
 * the screens show a game just played.
 */
import { MATCHES_PATH, type Ack, type MatchHistory, type UserCredentials } from "@hf/shared";
import type { Post } from "./identity";

/** How long an answer is kept before the server is asked again. */
export const HISTORY_FRESH_MS = 60_000;

const KEY_PREFIX = "hf.history:";
const UNREACHABLE = "could not reach the server; try again";

interface Kept {
  /** When it was asked for, by the device's clock. */
  readonly at: number;
  readonly answer: Promise<Ack<MatchHistory>>;
}

/** Answers by user id, failures and asks still on their way included. */
const kept = new Map<string, Kept>();
/**
 * Moves on each `forgetHistory`, so an answer still on its way when the history
 * was forgotten is not stored for the next screen to read as fresh.
 */
let generation = 0;

function fresh(at: number, now: number): boolean {
  return now - at >= 0 && now - at < HISTORY_FRESH_MS;
}

function readStored(userId: string, now: number): MatchHistory | null {
  try {
    const raw = window.sessionStorage.getItem(KEY_PREFIX + userId);
    if (raw === null) return null;
    const stored = JSON.parse(raw) as { at?: unknown; history?: unknown };
    if (typeof stored.at !== "number" || !fresh(stored.at, now)) return null;
    return (stored.history as MatchHistory | undefined) ?? null;
  } catch {
    return null;
  }
}

function writeStored(userId: string, at: number, history: MatchHistory): void {
  try {
    window.sessionStorage.setItem(KEY_PREFIX + userId, JSON.stringify({ at, history }));
  } catch {
    // Blocked or full storage: memory still keeps it for this page.
  }
}

/** The history for `user`, from the last minute's answer if there is one. */
export function loadHistory(
  post: Post,
  user: UserCredentials,
  now: number = Date.now(),
): Promise<Ack<MatchHistory>> {
  const inMemory = kept.get(user.userId);
  if (inMemory && fresh(inMemory.at, now)) return inMemory.answer;
  const stored = readStored(user.userId, now);
  if (stored) return Promise.resolve({ ok: true, data: stored });
  const askedIn = generation;
  const answer = post(MATCHES_PATH, { user }).then(
    (reply): Ack<MatchHistory> => {
      if (!reply.ok) return reply;
      const history = reply.data as MatchHistory;
      if (askedIn === generation) writeStored(user.userId, now, history);
      return { ok: true, data: history };
    },
    (): Ack<MatchHistory> => ({ ok: false, error: UNREACHABLE }),
  );
  kept.set(user.userId, { at: now, answer });
  return answer;
}

/** Forget every kept answer, so the next screen asks the server afresh. */
export function forgetHistory(): void {
  generation++;
  kept.clear();
  try {
    const storage = window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // No storage to clear.
  }
}
