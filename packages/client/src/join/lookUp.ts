/**
 * Whether the table a link names is still open, asked once as the link is opened
 * by someone without a seat there. A table that has closed is said to be gone
 * there and then, rather than offering a seat whose refusal comes only after the
 * player has filled in their card.
 *
 * Anything but a clear answer is "unknown" (no network, a server from before the
 * route existed), and the link then works as it always did: the seat is offered,
 * and the table's own answer to sitting down is the last word.
 */
import { NO_ROOM, tablePath } from "@hf/shared";
import { serverUrl } from "../socket";

export type TableState = "open" | "gone" | "unknown";

/** Just the part of `fetch` this needs, so tests can answer it. */
export type Get = (path: string) => Promise<unknown>;

export function httpGet(base: string): Get {
  return async (path) => (await fetch(`${base}${path}`)).json();
}

/**
 * How long the link waits for the answer before offering the seat anyway. The
 * join card waits on it, so a request that stalls must not keep it shut.
 */
export const LOOK_TIMEOUT_MS = 3000;

export async function lookUpTable(
  code: string,
  get: Get = httpGet(serverUrl()),
): Promise<TableState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("no answer")), LOOK_TIMEOUT_MS);
  });
  try {
    const answer = (await Promise.race([get(tablePath(code)), late])) as {
      ok?: unknown;
      error?: unknown;
    } | null;
    if (answer?.ok === true) return "open";
    if (answer?.ok === false && answer.error === NO_ROOM) return "gone";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/** What the home screen says when a link's table has closed. */
export function tableGone(code: string): string {
  return `Table ${code} has closed, or the link is wrong.`;
}
