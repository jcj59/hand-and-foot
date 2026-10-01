import { describe, it, expect } from "vitest";
import {
  MAX_NAME_LENGTH,
  isUserCredentials,
  normalizeName,
  parseTransferCode,
  transferCode,
} from "./identity";

const ana = { userId: "ana-user-id-0001", secret: "a".repeat(40) };

describe("an identity", () => {
  it("is a long random id and a longer random secret, nothing else", () => {
    expect(isUserCredentials(ana)).toBe(true);
    expect(isUserCredentials({ ...ana, extra: 1 })).toBe(true);
    for (const bad of [
      null,
      undefined,
      "ana",
      { userId: ana.userId },
      { secret: ana.secret },
      { userId: "x".repeat(15), secret: ana.secret },
      { userId: "x".repeat(65), secret: ana.secret },
      { userId: ana.userId, secret: "s".repeat(31) },
      { userId: ana.userId, secret: "s".repeat(129) },
      { userId: "has a space in it!", secret: ana.secret },
      { userId: ana.userId, secret: 7 },
    ]) {
      expect(isUserCredentials(bad)).toBe(false);
    }
  });

  it("moves between devices as one code, and only a real one reads back", () => {
    const code = transferCode(ana);
    expect(code).toBe(`hf1.${ana.userId}.${ana.secret}`);
    expect(parseTransferCode(`  ${code}\\n`.replace("\\n", "\n"))).toEqual(ana);
    for (const bad of [
      "",
      "hf1",
      "hf2.a.b",
      `hf1.${ana.userId}`,
      `hf1.short.${ana.secret}`,
      `${code}.x`,
    ]) {
      expect(parseTransferCode(bad)).toBeNull();
    }
  });
});

describe("a player's name", () => {
  it("is trimmed, has its spaces collapsed, and is capped", () => {
    // Pinned as a literal: the name box and the server agree on it.
    expect(MAX_NAME_LENGTH).toBe(24);
    expect(normalizeName("  Ana   Banana  ")).toBe("Ana Banana");
    expect(normalizeName("x".repeat(40))).toHaveLength(24);
    expect(normalizeName(undefined)).toBe("");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName(42)).toBe("42");
  });
});
