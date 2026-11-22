import { describe, expect, it } from "vitest";
import {
  fitToBytes,
  jsonBytes,
  MAX_REPORT_BODY_BYTES,
  MAX_REPORT_BYTES,
  REMOVED,
  REPORT_TEXT_MAX,
  scrubSecrets,
  TRUNCATED,
} from "./reports";

const TOKEN = "q7Lk2mXz0123456789abcdef";
const SECRET = "identity-secret-abcdefghijklmnopqrstuvwxyz0123";

describe("the report limits", () => {
  it("are 2000 characters, 256 KB from a client, 512 KB kept", () => {
    expect(REPORT_TEXT_MAX).toBe(2000);
    expect(MAX_REPORT_BODY_BYTES).toBe(262_144);
    expect(MAX_REPORT_BYTES).toBe(524_288);
  });
});

describe("jsonBytes", () => {
  it("counts UTF-8 bytes of JSON, and nothing as nothing", () => {
    expect(jsonBytes("é")).toBe(4);
    expect(jsonBytes(undefined)).toBe(0);
  });
});

describe("scrubSecrets", () => {
  it("removes every value under a secret's key, at any depth and any case", () => {
    const scrubbed = scrubSecrets({
      credentials: { roomId: "ABC234", seat: 1, token: TOKEN },
      identity: { userId: "ana-0001", secret: SECRET },
      list: [{ hostToken: "host-token-0000000" }],
      account: { password: "hunter2hunter2", newPassword: "x", Authorization: "Bearer abc" },
      headers: { cookie: "a=b" },
      nested: { tokens: ["one-token-aaaaaaaa", "two-token-bbbbbbbb"] },
    });
    expect(scrubbed).toEqual({
      credentials: { roomId: "ABC234", seat: 1, token: REMOVED },
      identity: { userId: "ana-0001", secret: REMOVED },
      list: [{ hostToken: REMOVED }],
      account: { password: REMOVED, newPassword: REMOVED, Authorization: REMOVED },
      headers: { cookie: REMOVED },
      nested: { tokens: REMOVED },
    });
  });

  it("cuts a secret found under its key out of every other string and key", () => {
    const scrubbed = scrubSecrets({
      "hf.seat": { token: TOKEN },
      console: [`resuming with ${TOKEN} now`, `sent ${JSON.stringify({ secret: SECRET })}`],
      seatsBy: { [TOKEN]: 1 },
      frame: { event: "resumeSeat", payload: `{"t":"${TOKEN}"}` },
    });
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(TOKEN);
    expect(scrubbed.console[0]).toBe(`resuming with ${REMOVED} now`);
    expect(scrubbed.seatsBy).toEqual({ [REMOVED]: 1 });
    // The secret was only ever inside a string here, never under its key, so the
    // key search cannot see it; passing it as known removes it too.
    expect(json).toContain(SECRET);
    expect(JSON.stringify(scrubSecrets(scrubbed, [SECRET]))).not.toContain(SECRET);
  });

  it("finds a secret held deep under a secret's key, and cuts it from elsewhere", () => {
    const scrubbed = scrubSecrets({
      kept: { tokens: [{ seat: "deep-secret-0001" }] },
      line: "saw deep-secret-0001",
    });
    expect(scrubbed).toEqual({ kept: { tokens: REMOVED }, line: `saw ${REMOVED}` });
  });

  it("searches for known secrets everywhere, but never for short strings", () => {
    const value = { a: `x${SECRET}y`, b: ["abc", 1, null, true], c: "abc" };
    expect(scrubSecrets(value, [SECRET, "abc"])).toEqual({
      a: `x${REMOVED}y`,
      b: ["abc", 1, null, true],
      c: "abc",
    });
  });

  it("cuts a longer secret whole when a shorter one is inside it", () => {
    const short = "token-aaaaaaa1";
    const long = `${short}-and-more`;
    expect(scrubSecrets({ s: `<${long}>` }, [short, long])).toEqual({ s: `<${REMOVED}>` });
  });

  it("leaves a value with no secret as it was, and never changes its input", () => {
    const value = { a: [1, { b: "c" }], d: null };
    const copy = structuredClone(value);
    expect(scrubSecrets(value)).toEqual(copy);
    const held = { token: TOKEN };
    scrubSecrets(held);
    expect(held.token).toBe(TOKEN);
  });

  it("stops at a depth no real report reaches", () => {
    let deep: unknown = "bottom";
    for (let i = 0; i < 100; i++) deep = { next: deep };
    expect(JSON.stringify(scrubSecrets(deep))).toContain(REMOVED);
    expect(JSON.stringify(scrubSecrets(deep, [TOKEN]))).toContain(REMOVED);
  });
});

describe("fitToBytes", () => {
  const items = (n: number, size = 100) =>
    Array.from({ length: n }, (_, i) => `${i}:${"x".repeat(size)}`);

  it("leaves a value that fits alone, with nothing truncated", () => {
    const value = { a: items(3) };
    const fitted = fitToBytes(value, 10_000, { sections: [[]] });
    expect(fitted.value).toBe(value);
    expect(fitted.truncated).toEqual([]);
  });

  it("cuts the largest section first, its oldest entries, and says so", () => {
    const value = { big: items(100), small: items(5), note: "hello" };
    const max = jsonBytes(value) - 3_000;
    const { value: fitted, truncated } = fitToBytes(value, max, { sections: [[]] });
    expect(jsonBytes(fitted)).toBeLessThanOrEqual(max);
    expect(fitted.small).toEqual(value.small);
    expect(fitted.note).toBe("hello");
    // The newest kept, the oldest gone.
    expect(fitted.big.at(-1)).toBe(value.big.at(-1));
    expect(fitted.big[0]).not.toBe(value.big[0]);
    expect(truncated).toEqual([
      { section: "big", bytes: jsonBytes(value.big), kept: fitted.big.length, of: 100 },
    ]);
    expect((fitted as unknown as { truncated: unknown }).truncated).toEqual(truncated);
    // Not more than it needed: one more entry would not have fit.
    const oneMore = { ...fitted, big: value.big.slice(-(fitted.big.length + 1)) };
    expect(jsonBytes(oneMore)).toBeGreaterThan(max);
  });

  it("moves on to the next largest once the first is no larger than it", () => {
    const value = { a: items(40), b: items(30), c: "x".repeat(50) };
    const { value: fitted, truncated } = fitToBytes(value, jsonBytes(value) / 2, {
      sections: [[]],
    });
    expect(truncated.map((t) => t.section).sort()).toEqual(["a", "b"]);
    expect(Math.abs(fitted.a.length - fitted.b.length)).toBeLessThanOrEqual(1);
    expect(fitted.c).toBe(value.c);
  });

  it("replaces a section that is not a list, or a list of one, with the marker", () => {
    const value = { blob: { text: "y".repeat(5_000) }, one: ["z".repeat(5_000)], keep: 1 };
    const { value: fitted, truncated } = fitToBytes(value, 1_000, { sections: [[]] });
    expect(fitted).toMatchObject({ blob: TRUNCATED, one: TRUNCATED, keep: 1 });
    expect(truncated).toEqual([
      { section: "blob", bytes: jsonBytes(value.blob) },
      { section: "one", bytes: jsonBytes(value.one) },
    ]);
  });

  it("cuts inside listed containers, never the containers themselves", () => {
    const value = { logs: { frames: items(50), console: items(5) }, other: items(5) };
    const { value: fitted } = fitToBytes(value, jsonBytes(value) - 2_000, {
      sections: [[], ["logs"]],
    });
    expect(Array.isArray(fitted.logs.frames)).toBe(true);
    expect(fitted.logs.frames.length).toBeLessThan(50);
    expect(fitted.other).toEqual(value.other);
  });

  it("cuts the last sections only when nothing else is left, keeping a list's start", () => {
    const value = {
      record: { actions: items(100), state: { s: "s".repeat(3_000) }, chat: items(10) },
      logs: items(10),
    };
    const plan = {
      sections: [[], ["record"]],
      last: [
        ["record", "actions"],
        ["record", "state"],
      ],
    };
    // Room for everything but the logs and the chat: only they go.
    const roomy = fitToBytes(value, jsonBytes(value) - 1_500, plan);
    expect(roomy.value.record.actions).toEqual(value.record.actions);
    expect(roomy.value.record.state).toEqual(value.record.state);
    expect(roomy.truncated.map((t) => t.section).sort()).toEqual(["logs", "record.chat"]);
    // Tighter: the actions are cut from their end, so what is left still replays.
    const tight = fitToBytes(value, 8_000, plan);
    expect(jsonBytes(tight.value)).toBeLessThanOrEqual(8_000);
    expect(tight.value.record.actions[0]).toBe(value.record.actions[0]);
    expect(tight.value.record.actions.length).toBeLessThan(100);
    expect(tight.value.record.state).toEqual(value.record.state);
    // Tighter still: the state goes last of all.
    const tiny = fitToBytes(value, 600, plan);
    expect(tiny.value.record.actions).toBe(TRUNCATED);
    expect(tiny.value.record.state).toBe(TRUNCATED);
    expect(tiny.truncated.map((t) => t.section).slice(-2)).toEqual([
      "record.actions",
      "record.state",
    ]);
    const actions = tiny.truncated.find((t) => t.section === "record.actions")!;
    expect(actions).toEqual({ section: "record.actions", bytes: jsonBytes(value.record.actions) });
  });

  it("answers what it could when even everything cut does not fit", () => {
    const value = { text: "t".repeat(5_000), list: items(10) };
    const { value: fitted } = fitToBytes(value, 1_000, { sections: [] });
    expect(fitted).toEqual(value);
  });

  it("never cuts a value smaller than the marker, nor an earlier truncated list", () => {
    const value = { truncated: ["x".repeat(500)], tiny: [1], big: items(20) };
    const { value: fitted } = fitToBytes(value, jsonBytes(value) - 500, { sections: [[]] });
    expect(fitted.tiny).toEqual([1]);
    // Even once nothing larger is left, a value smaller than the marker stays.
    const small = { tiny: [1], blob: { b: "b".repeat(2_000) } };
    expect(fitToBytes(small, 10, { sections: [[]] }).value.tiny).toEqual([1]);
  });
});
