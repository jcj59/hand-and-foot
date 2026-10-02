/**
 * Reading the process environment, kept apart from starting the server so that
 * the parsing can be tested without binding a port.
 *
 * Operator configuration is validated rather than coerced, as a room's rules
 * are (`resolveRules`): quietly ignoring `PORT=808O` would leave whoever deploys
 * the server believing they had configured something they had not. A bad value
 * stops the process at boot, which is the cheapest place to notice it.
 */
import type { ServerOptions } from "./index";

/** Where the server listens when `PORT` is unset. */
export const DEFAULT_PORT = 3000;

export interface ServerEnv {
  readonly port: number;
  readonly options: ServerOptions;
  /** Where rooms are persisted. Unset keeps them in memory, lost on restart. */
  readonly databaseUrl: string | undefined;
}

/** Mirrors `RoomResult`: a bad environment is reported, never thrown. */
export type ServerEnvResult =
  { readonly ok: true; readonly value: ServerEnv } | { readonly ok: false; readonly error: string };

/** Only what this server reads, so a test can pass an object literal. */
export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * A whole non-negative number and nothing else. `Number` would accept `""` as
 * 0, `"1e3"` as 1000 and `"0x10"` as 16; `parseInt` would accept `"12abc"` as
 * 12. Every one of those is far likelier to be a typo than an intention.
 * Surrounding whitespace is forgiven, since compose files and shell exports
 * introduce it by accident.
 */
function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

type MaybeMs =
  | { readonly ok: true; readonly value: number | undefined }
  | { readonly ok: false; readonly error: string };

/**
 * An optional duration. Blank is treated as unset rather than as zero, because
 * an unset variable and one exported empty are hard to tell apart, and zero
 * here means "no grace at all" — too sharp a behaviour to arrive by accident.
 */
function optionalMs(env: Environment, key: string): MaybeMs {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return { ok: true, value: undefined };
  const ms = wholeNumber(raw);
  if (ms === null) {
    return {
      ok: false,
      error: `${key} must be a whole number of milliseconds, not ${JSON.stringify(raw)}`,
    };
  }
  return { ok: true, value: ms };
}

/**
 * Allowed origins, comma-separated because an environment variable cannot hold
 * a list. Unset and blank both mean "any origin", matching `createServer`'s
 * default: a deployment that intends to restrict origins names them.
 */
function corsOrigins(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return origins.length > 0 ? origins : undefined;
}

/**
 * The connection string, checked for shape only; whether it connects is found out
 * at boot. Blank is unset, as for the durations. The error never repeats the
 * value, because it carries the database password and error messages end up in
 * logs.
 */
function databaseUrl(
  raw: string | undefined,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: undefined };
  const trimmed = raw.trim();
  let protocol: string;
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    return { ok: false, error: "DATABASE_URL must be a postgres:// or postgresql:// URL" };
  }
  return { ok: true, value: trimmed };
}

/**
 * Turn the environment into the arguments `createServer` and `listen` take.
 *
 * `PORT` is unprefixed because every host that injects one — Fly, Render,
 * Heroku — calls it that. The server's own settings are `HF_`-prefixed so they
 * cannot collide with anything else in a container's environment, except
 * `DATABASE_URL`, which is the name Fly, Neon and nearly every host already use
 * for exactly this. Note that
 * these are operational settings only: the pacing timers that change how the
 * game plays belong to the room's `RulesConfig`, not here.
 */
export function parseServerEnv(env: Environment): ServerEnvResult {
  const port = env.PORT === undefined ? DEFAULT_PORT : wholeNumber(env.PORT);
  // Port 0 is kept legal: it asks the OS for a free port, which is how the
  // tests and some container setups bind.
  if (port === null || port > 65_535) {
    return {
      ok: false,
      error: `PORT must be a whole number from 0 to 65535, not ${JSON.stringify(env.PORT)}`,
    };
  }

  const reconnectGraceMs = optionalMs(env, "HF_RECONNECT_GRACE_MS");
  if (!reconnectGraceMs.ok) return reconnectGraceMs;
  const abandonedRoomMs = optionalMs(env, "HF_ABANDONED_ROOM_MS");
  if (!abandonedRoomMs.ok) return abandonedRoomMs;
  const database = databaseUrl(env.DATABASE_URL);
  if (!database.ok) return database;

  return {
    ok: true,
    value: {
      port,
      options: {
        reconnectGraceMs: reconnectGraceMs.value,
        abandonedRoomMs: abandonedRoomMs.value,
        cors: corsOrigins(env.HF_CORS_ORIGINS),
      },
      databaseUrl: database.value,
    },
  };
}
