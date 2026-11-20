/**
 * The page's last few errors, kept so a bug report can carry them.
 *
 * A player who reports a bug rarely knows what broke; the browser often does,
 * in an error nobody saw. `installErrorLog` (called once, from `main.tsx`)
 * listens for uncaught errors and unhandled promise rejections and keeps the
 * last `ERRORS_KEPT` of them in memory, each cut to a size a report can carry.
 * Nothing is stored or sent until the player sends a report themselves.
 */

/** How many errors are kept: the newest, the oldest dropped first. */
export const ERRORS_KEPT = 20;
/** The longest message kept, in characters. */
export const ERROR_MESSAGE_MAX = 300;
/** The longest stack kept, in characters: enough for the first few frames. */
export const ERROR_STACK_MAX = 600;

export interface ClientError {
  /** When it happened, in milliseconds since the epoch. */
  readonly at: number;
  readonly message: string;
  /** The script and line it came from, when the browser said. */
  readonly where?: string;
  readonly stack?: string;
}

/** `list` with `item` added last, keeping only the newest `max`. Never changes `list`. */
export function keepLast<T>(list: readonly T[], item: T, max: number): T[] {
  return [...list, item].slice(-max);
}

/** `text` cut to `max` characters, marked with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * What was thrown or rejected, as a kept error. Anything can be thrown, not
 * only an `Error`, so a string is kept as its message and anything else as what
 * `String` makes of it.
 */
export function describeError(reason: unknown, at: number, where?: string): ClientError {
  const error = reason instanceof Error ? reason : null;
  const message = clip(
    error ? `${error.name}: ${error.message}` : safeString(reason),
    ERROR_MESSAGE_MAX,
  );
  const stack = error?.stack ? clip(error.stack, ERROR_STACK_MAX) : undefined;
  return {
    at,
    message,
    ...(where ? { where: clip(where, ERROR_MESSAGE_MAX) } : {}),
    ...(stack ? { stack } : {}),
  };
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    // An object whose own `toString` throws.
    return "an error that could not be read";
  }
}

let kept: ClientError[] = [];

/** Keep one more error. */
export function noteError(error: ClientError): void {
  kept = keepLast(kept, error, ERRORS_KEPT);
}

/** The kept errors, oldest first. */
export function recentErrors(): readonly ClientError[] {
  return kept;
}

/** Forget every kept error (between tests). */
export function forgetErrors(): void {
  kept = [];
}

/**
 * Listen on `target` (the window) for uncaught errors and unhandled rejections,
 * keeping each. Returns a teardown. The listeners only record: the browser
 * still logs the error to its console as before.
 */
export function installErrorLog(target: Window, now: () => number = Date.now): () => void {
  const onError = (event: ErrorEvent): void => {
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
    // `error` is null for an error from a script on another origin, and for one
    // raised by hand without it: the message is all there is.
    noteError(describeError(event.error ?? event.message, now(), where));
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    noteError(describeError(event.reason, now(), "unhandled rejection"));
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
