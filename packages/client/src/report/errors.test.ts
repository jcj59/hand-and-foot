import { afterEach, describe, expect, it } from "vitest";
import {
  clip,
  describeError,
  ERROR_MESSAGE_MAX,
  ERROR_STACK_MAX,
  ERRORS_KEPT,
  forgetErrors,
  installErrorLog,
  keepLast,
  noteError,
  recentErrors,
} from "./errors";

afterEach(forgetErrors);

describe("keeping the last few", () => {
  it("adds last and drops the oldest past the limit", () => {
    expect(keepLast([1, 2], 3, 3)).toEqual([1, 2, 3]);
    expect(keepLast([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  it("never changes the list it was given", () => {
    const list = [1, 2, 3];
    keepLast(list, 4, 3);
    expect(list).toEqual([1, 2, 3]);
  });

  it("keeps 20 errors, the newest", () => {
    expect(ERRORS_KEPT).toBe(20);
    for (let at = 1; at <= 25; at++) noteError({ at, message: `e${at}` });
    expect(recentErrors().map((e) => e.at)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
  });

  it("forgets them all", () => {
    noteError({ at: 1, message: "e" });
    forgetErrors();
    expect(recentErrors()).toEqual([]);
  });
});

describe("cutting text", () => {
  it("keeps text at the limit and marks text past it", () => {
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("abcd", 3)).toBe("ab…");
    expect(clip("abcd", 3)).toHaveLength(3);
  });

  it("caps a message at 300 characters and a stack at 600", () => {
    expect(ERROR_MESSAGE_MAX).toBe(300);
    expect(ERROR_STACK_MAX).toBe(600);
    const error = new Error("m".repeat(1_000));
    error.stack = "s".repeat(1_000);
    const kept = describeError(error, 5, "w".repeat(1_000));
    expect(kept.message).toHaveLength(300);
    expect(kept.stack).toHaveLength(600);
    expect(kept.where).toHaveLength(300);
  });
});

describe("describing what was thrown", () => {
  it("names an error by its kind and message, with its stack and where it came from", () => {
    const error = new TypeError("x is undefined");
    error.stack = "TypeError: x is undefined\n    at f (index.js:1:2)";
    expect(describeError(error, 7, "index.js:1:2")).toEqual({
      at: 7,
      message: "TypeError: x is undefined",
      where: "index.js:1:2",
      stack: "TypeError: x is undefined\n    at f (index.js:1:2)",
    });
  });

  it("keeps a thrown string as the message, with nothing else", () => {
    expect(describeError("boom", 1)).toEqual({ at: 1, message: "boom" });
  });

  it("leaves out an empty stack", () => {
    const error = new Error("quiet");
    error.stack = "";
    expect(describeError(error, 1)).toStrictEqual({ at: 1, message: "Error: quiet" });
  });

  it("survives a thrown value that cannot be written out", () => {
    const hostile = {
      toString() {
        throw new Error("no");
      },
    };
    expect(describeError(hostile, 1).message).toBe("an error that could not be read");
  });
});

describe("listening to the page", () => {
  it("keeps uncaught errors and unhandled rejections, and stops when torn down", () => {
    const stop = installErrorLog(window, () => 42);
    const thrown = new RangeError("too far");
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: thrown,
        message: "Uncaught RangeError: too far",
        filename: "https://hf.test/assets/index.js",
        lineno: 3,
        colno: 9,
      }),
    );
    // A script error from another origin carries no error object, only its message.
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = "nobody caught me";
    window.dispatchEvent(rejection);

    expect(recentErrors()).toEqual([
      expect.objectContaining({
        at: 42,
        message: "RangeError: too far",
        where: "https://hf.test/assets/index.js:3:9",
      }),
      { at: 42, message: "Script error." },
      { at: 42, message: "nobody caught me", where: "unhandled rejection" },
    ]);

    stop();
    window.dispatchEvent(new ErrorEvent("error", { message: "after" }));
    window.dispatchEvent(new Event("unhandledrejection"));
    expect(recentErrors()).toHaveLength(3);
  });
});
