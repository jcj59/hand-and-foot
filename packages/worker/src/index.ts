/**
 * The Worker: the game's HTTP API and table sockets, and the client's built files.
 *
 * Opening a table and sitting down at one are plain requests, answered by the
 * table's Durable Object; a table's socket is handed straight to it. Everything
 * else is the client, served from the static assets.
 */
import {
  changePassword,
  claimUsername,
  signIn,
  signOut,
  type AccountStores,
} from "@hf/server/core";
import {
  CLAIM_PATH,
  HEALTH_PATH,
  isUserCredentials,
  isUserId,
  MATCHES_PATH,
  MATCH_PATH,
  NOT_AN_IDENTITY,
  parseAvatar,
  parseUsername,
  PASSWORD_PATH,
  parseRoomPath,
  resolveRules,
  ROOMS_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  usernameKey,
  USERS_PATH,
} from "@hf/shared";
import { newCode } from "./codes";
import type { Env } from "./env";
import { TAKEN } from "./table";

export { TableObject } from "./table";
export { UserObject } from "./users";
export { LoginObject } from "./logins";

/** The largest request body read, well above any real one. */
const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The request body as a JSON object, or null if it is not one or is too large. */
async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The user id a request's credentials prove, or null. A well-formed id is checked
 * before an object is addressed by it, so a request cannot make objects out of
 * arbitrary strings.
 */
async function verified(env: Env, user: unknown): Promise<string | null> {
  if (!isUserCredentials(user)) return null;
  try {
    return await env.USERS.getByName(user.userId).verify(user);
  } catch {
    // An identity object that cannot answer is no reason to refuse a seat.
    return null;
  }
}

/**
 * The account rules' two stores, each record kept in its own object. Only a
 * well-formed id or username is used to address one, as for sitting down.
 */
function accountStores(env: Env): AccountStores {
  const isKey = (key: string): boolean => parseUsername(key) === key && usernameKey(key) === key;
  return {
    users: {
      get: async (userId) => (isUserId(userId) ? env.USERS.getByName(userId).load(userId) : null),
      put: async (record) => env.USERS.getByName(record.userId).save(record),
    },
    logins: {
      get: async (key) => (isKey(key) ? env.LOGINS.getByName(key).load(key) : null),
      put: async (record) => env.LOGINS.getByName(record.key).save(record),
      delete: async (key, userId) => env.LOGINS.getByName(key).release(key, userId),
    },
  };
}

const ACCOUNT_ROUTES = {
  [CLAIM_PATH]: claimUsername,
  [SIGN_IN_PATH]: signIn,
  [PASSWORD_PATH]: changePassword,
  [SIGN_OUT_PATH]: signOut,
} as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === HEALTH_PATH) return json({ ok: true });

    if (pathname === USERS_PATH && request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: "that request was not JSON" }, 400);
      if (!isUserCredentials(body)) return json({ ok: false, error: NOT_AN_IDENTITY });
      return json(await env.USERS.getByName(body.userId).register(body, Date.now()));
    }

    if (Object.hasOwn(ACCOUNT_ROUTES, pathname) && request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: "that request was not JSON" }, 400);
      const handle = ACCOUNT_ROUTES[pathname as keyof typeof ACCOUNT_ROUTES];
      return json(await handle(accountStores(env), body, Date.now()));
    }

    if (pathname === MATCHES_PATH && request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: "that request was not JSON" }, 400);
      if (!isUserCredentials(body.user)) return json({ ok: false, error: NOT_AN_IDENTITY });
      return json(await env.USERS.getByName(body.user.userId).history(body.user));
    }

    if (pathname === MATCH_PATH && request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: "that request was not JSON" }, 400);
      if (!isUserCredentials(body.user)) return json({ ok: false, error: NOT_AN_IDENTITY });
      return json(await env.USERS.getByName(body.user.userId).replay(body.user, body.id));
    }

    if (pathname === ROOMS_PATH && request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: "that request was not JSON" }, 400);
      // Checked here, before a code is drawn: rules that do not make a game open nothing.
      const rules = resolveRules(body.options);
      if (!rules.ok) return json(rules);
      const config = rules.data;
      const name = String(body.name ?? "");
      const profile = { userId: await verified(env, body.user), avatar: parseAvatar(body.avatar) };
      // Each code is its own object; one already in use says so, and another is drawn.
      for (;;) {
        const code = newCode();
        const opened = await env.TABLES.getByName(code).open(code, config, name, profile);
        if (opened !== TAKEN) return json(opened);
      }
    }

    const target = parseRoomPath(pathname);
    if (target) {
      // Codes are matched without regard to case; nobody types a link exactly.
      const table = env.TABLES.getByName(target.roomId.toUpperCase());
      if (target.what === "socket") return table.fetch(request);
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: "that request was not JSON" }, 400);
      return json(
        await table.sit(String(body.name ?? ""), {
          userId: await verified(env, body.user),
          avatar: parseAvatar(body.avatar),
        }),
      );
    }

    if (pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
