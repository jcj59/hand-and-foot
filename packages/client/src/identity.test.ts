import { afterEach, describe, it, expect, vi } from "vitest";
import { IDENTITY_TAKEN, UNKNOWN_IDENTITY, type Ack } from "@hf/shared";
import {
  IDENTITY_KEY,
  NAME_KEY,
  REGISTER_TIMEOUT_MS,
  adoptTransferCode,
  ensureIdentity,
  loadIdentity,
  loadName,
  newIdentity,
  prepareIdentity,
  randomToken,
  rememberName,
  type Post,
} from "./identity";

afterEach(() => {
  window.localStorage.removeItem(IDENTITY_KEY);
  window.localStorage.removeItem(NAME_KEY);
  vi.useRealTimers();
});

const answering = (...answers: Ack<unknown>[]): Post & { sent: unknown[] } => {
  const sent: unknown[] = [];
  const post = (async (_: string, body: unknown) => {
    sent.push(body);
    return answers.shift() ?? { ok: true, data: {} };
  }) as Post & { sent: unknown[] };
  post.sent = sent;
  return post;
};

describe("this browser's identity", () => {
  it("is made once and kept, from long random strings the server accepts", () => {
    const made = ensureIdentity();
    expect(made.userId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(made.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ensureIdentity()).toEqual(made);
    expect(loadIdentity()).toEqual(made);
    expect(newIdentity()).not.toEqual(made);
    expect(randomToken(4, (bytes) => bytes.fill(255))).toBe("____");
  });

  it("is replaced rather than trusted when what is stored is damaged", () => {
    window.localStorage.setItem(IDENTITY_KEY, "{not json");
    expect(loadIdentity()).toBeNull();
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ userId: "x", secret: "y" }));
    expect(loadIdentity()).toBeNull();
    expect(ensureIdentity().userId).toHaveLength(22);
  });

  it("works for the length of the page when storage is blocked", () => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(loadIdentity()).toBeNull();
      expect(ensureIdentity().userId).toHaveLength(22);
      expect(loadName()).toBe("");
      rememberName("Ana");
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
    }
  });

  it("remembers the name it last sat down as, tidied", () => {
    rememberName("  Ana   Banana ");
    expect(loadName()).toBe("Ana Banana");
  });
});

describe("registering before sitting down", () => {
  it("registers the identity under the name and returns it", async () => {
    const post = answering();
    const identity = await prepareIdentity(post, "Ana");
    expect(identity).toEqual(loadIdentity());
    expect(post.sent).toEqual([{ ...identity, name: "Ana" }]);
  });

  it("makes a fresh identity when the server says this one belongs to someone else", async () => {
    const before = ensureIdentity();
    const post = answering({ ok: false, error: IDENTITY_TAKEN });
    const identity = await prepareIdentity(post, "Ana");
    expect(identity).not.toEqual(before);
    expect(loadIdentity()).toEqual(identity);
    expect(post.sent).toHaveLength(2);
  });

  it("gives up, without an identity, when the server cannot be reached or does not answer", async () => {
    const failing: Post = async () => {
      throw new Error("offline");
    };
    expect(await prepareIdentity(failing, "Ana")).toBeNull();
    const refusing = answering(
      { ok: false, error: IDENTITY_TAKEN },
      { ok: false, error: IDENTITY_TAKEN },
    );
    expect(await prepareIdentity(refusing, "Ana")).toBeNull();
    vi.useFakeTimers();
    const silent: Post = () => new Promise(() => {});
    const pending = prepareIdentity(silent, "Ana");
    vi.advanceTimersByTime(REGISTER_TIMEOUT_MS);
    expect(await pending).toBeNull();
  });

  it("keeps the identity it has when the server refuses for any other reason", async () => {
    const before = ensureIdentity();
    const post = answering({ ok: false, error: "the server could not answer that; try again" });
    expect(await prepareIdentity(post, "Ana")).toBeNull();
    expect(loadIdentity()).toEqual(before);
    expect(post.sent).toEqual([{ ...before, name: "Ana" }]);
  });
});

describe("moving an identity from another device", () => {
  const other = { userId: "other-device-user-01", secret: "s".repeat(40) };

  it("takes on an identity the server knows", async () => {
    const post = answering();
    expect(await adoptTransferCode(post, ` hf1.${other.userId}.${other.secret} `)).toEqual({
      ok: true,
      data: other,
    });
    expect(loadIdentity()).toEqual(other);
    expect(post.sent).toEqual([{ ...other, existing: true }]);
  });

  it("keeps this device's identity for a code that is wrong, unknown, or cannot be checked", async () => {
    const mine = ensureIdentity();
    expect(await adoptTransferCode(answering(), "hf2.a.b")).toEqual({
      ok: false,
      error: "that is not a transfer code",
    });
    const code = `hf1.${other.userId}.${other.secret}`;
    expect(
      await adoptTransferCode(answering({ ok: false, error: UNKNOWN_IDENTITY }), code),
    ).toEqual({
      ok: false,
      error: "that code is not a known identity",
    });
    expect(
      await adoptTransferCode(
        answering({ ok: false, error: "the server could not answer that; try again" }),
        code,
      ),
    ).toEqual({ ok: false, error: "could not check that code; try again" });
    const offline: Post = async () => {
      throw new Error("offline");
    };
    expect(await adoptTransferCode(offline, code)).toEqual({
      ok: false,
      error: "could not reach the server; try again",
    });
    expect(loadIdentity()).toEqual(mine);
  });
});
