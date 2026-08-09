import { describe, it, expect } from "vitest";
import { FakeClock } from "./clock";
import { createServer } from "./index";

describe("createServer", () => {
  it("allows any origin by default and locks to the given list when asked", async () => {
    // The client is served from a different host in production, so CORS has to
    // be configurable; wide open is only the convenience default for local play.
    const open = createServer();
    expect(open.io.engine.opts.cors).toEqual({ origin: "*" });
    await open.close();

    const locked = createServer({ cors: ["https://handandfoot.example"] });
    expect(locked.io.engine.opts.cors).toEqual({
      origin: ["https://handandfoot.example"],
    });
    await locked.close();
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
});
