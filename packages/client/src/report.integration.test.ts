// @vitest-environment node
/**
 * A bug report against a real server, through the client's own HTTP: the
 * largest report the sheet can build is accepted whole, and the server's
 * refusal comes back as the sheet shows it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type HandAndFootServer } from "@hf/server";
import { sendReport } from "./actions";
import { httpPost, type Post } from "./identity";
import { fitReport, reportBody, reportContext } from "./report/context";
import { ERROR_MESSAGE_MAX, ERROR_STACK_MAX } from "./report/errors";

let server: HandAndFootServer;
let post: Post;

beforeEach(async () => {
  // The Node host logs each report it keeps; the test checks the answers instead.
  vi.spyOn(console, "log").mockImplementation(() => {});
  server = createServer();
  post = httpPost(`http://localhost:${await server.listen(0)}`);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

const page = {
  build: "abc1234",
  at: Date.now(),
  path: "/profile",
  userAgent: "Mozilla/5.0 (Test)",
  width: 1280,
  height: 800,
  pixelRatio: 1,
  phone: false,
  userId: null,
  username: null,
};

describe("sending a bug report", () => {
  it("is accepted, numbered in order, even at its largest", async () => {
    const errors = Array.from({ length: 20 }, (_, at) => ({
      at,
      message: "m".repeat(ERROR_MESSAGE_MAX),
      where: "w".repeat(ERROR_MESSAGE_MAX),
      stack: "s".repeat(ERROR_STACK_MAX),
    }));
    const small = reportBody(fitReport("It froze", reportContext({ ...page, errors: [] }, null)));
    expect(await sendReport(post, small)).toEqual({ ok: true, data: { id: 0 } });
    const large = reportBody(
      fitReport("🙂".repeat(1_000), reportContext({ ...page, errors }, null)),
    );
    expect(await sendReport(post, large)).toEqual({ ok: true, data: { id: 1 } });
  });

  it("brings back the server's refusal", async () => {
    const empty = reportBody(fitReport("   ", reportContext({ ...page, errors: [] }, null)));
    expect(await sendReport(post, empty)).toEqual({ ok: false, error: "say what went wrong" });
  });
});
