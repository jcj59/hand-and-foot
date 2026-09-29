/**
 * The Worker: the game's HTTP API and table sockets, and the client's built files.
 *
 * Opening a table and sitting down at one are plain requests, answered by the
 * table's Durable Object; a table's socket is handed straight to it. Everything
 * else is the client, served from the static assets.
 */
import { configFor } from "@hf/server/core";
import { HEALTH_PATH, parseRoomPath, ROOMS_PATH, type RoomOptions } from "@hf/shared";
import { newCode } from "./codes";
import type { Env } from "./env";
import { TAKEN } from "./table";

export { TableObject } from "./table";

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === HEALTH_PATH) return json({ ok: true });

    if (pathname === ROOMS_PATH && request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: "that request was not JSON" }, 400);
      const config = configFor(body.options as RoomOptions | undefined);
      const name = String(body.name ?? "");
      // Each code is its own object; one already in use says so, and another is drawn.
      for (;;) {
        const code = newCode();
        const opened = await env.TABLES.getByName(code).open(code, config, name);
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
      return json(await table.sit(String(body.name ?? "")));
    }

    if (pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
