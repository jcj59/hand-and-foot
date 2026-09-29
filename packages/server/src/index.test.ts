import { describe, it, expect } from "vitest";
import { FakeClock } from "./clock";
import { createServer } from "./index";
import { InMemoryRoomStore } from "./store";

/** Open a table over HTTP, as a browser at `origin` would. */
function openTable(port: number, origin: string): Promise<Response> {
  return fetch(`http://localhost:${port}/api/rooms`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "ana" }),
  });
}

describe("createServer", () => {
  it("allows any origin by default and locks to the given list when asked", async () => {
    // The client is served from a different host in production, so CORS has to
    // be configurable; wide open is only the convenience default for local play.
    const open = createServer();
    const openPort = await open.listen(0);
    const anywhere = await openTable(openPort, "https://anywhere.example");
    expect(anywhere.status).toBe(200);
    expect(anywhere.headers.get("access-control-allow-origin")).toBe("https://anywhere.example");
    await open.close();

    const locked = createServer({ cors: ["https://handandfoot.example"] });
    const port = await locked.listen(0);
    const ours = await openTable(port, "https://handandfoot.example");
    expect(ours.status).toBe(200);
    expect(ours.headers.get("access-control-allow-origin")).toBe("https://handandfoot.example");
    const theirs = await openTable(port, "https://elsewhere.example");
    expect(theirs.status).toBe(403);
    expect(theirs.headers.get("access-control-allow-origin")).toBeNull();
    await locked.close();
  });

  it("answers the browser's preflight for a cross-origin request", async () => {
    const server = createServer();
    const port = await server.listen(0);
    const preflight = await fetch(`http://localhost:${port}/api/rooms`, {
      method: "OPTIONS",
      headers: { origin: "https://handandfoot.example" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
    await server.close();
  });

  it("refuses a request body that is not JSON, or is too large", async () => {
    const server = createServer();
    const port = await server.listen(0);
    const post = (body: string) =>
      fetch(`http://localhost:${port}/api/rooms`, { method: "POST", body });
    expect((await post("not json")).status).toBe(400);
    expect((await post("[1]")).status).toBe(400);
    expect((await post(JSON.stringify({ name: "x".repeat(20_000) }))).status).toBe(400);
    await server.close();
  });

  it("reports the port the OS actually assigned when asked for any", async () => {
    // Tests and containers both bind port 0; the caller has to learn the result.
    const server = createServer();
    const port = await server.listen(0);
    expect(port).toBeGreaterThan(0);
    expect((server.http.address() as { port: number }).port).toBe(port);
    await server.close();
  });

  it("takes an injected clock, so a room's timers are drivable in tests", async () => {
    const clock = new FakeClock(4_242);
    const server = createServer({ clock });
    const room = server.manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);
    expect(room.clockState().serverNow).toBe(4_242);
    await server.close();
  });

  it("starts with no rooms", async () => {
    const server = createServer();
    expect(server.manager.size).toBe(0);
    await server.close();
  });

  it("answers a health check with the number of rooms, for the host to poll", async () => {
    const server = createServer();
    const port = await server.listen(0);
    server.manager.create();
    const response = await fetch(`http://localhost:${port}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true, rooms: 1 });
    await server.close();
  });

  it("answers anything else that is not the socket with a 404", async () => {
    const server = createServer();
    const port = await server.listen(0);
    expect((await fetch(`http://localhost:${port}/`)).status).toBe(404);
    expect((await fetch(`http://localhost:${port}/healthz`, { method: "POST" })).status).toBe(404);
    await server.close();
  });

  it("keeps its rooms in the store it is given, and closes that store on the way down", async () => {
    const store = new InMemoryRoomStore();
    let closed = false;
    store.close = async () => {
      closed = true;
    };
    const server = createServer({ store });
    const room = server.manager.create();
    expect((await store.loadOpen()).map((r) => r.room.uid)).toEqual([room.uid]);
    await server.close();
    expect(closed).toBe(true);
  });
});
