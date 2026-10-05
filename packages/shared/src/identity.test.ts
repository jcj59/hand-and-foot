import { describe, it, expect } from "vitest";
import {
  CLAIM_PATH,
  PASSWORD_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  isPassword,
  isUserCredentials,
  isUserId,
  parseUsername,
  usernameKey,
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

describe("a username", () => {
  it("is 3 to 24 letters, digits, dots, dashes or underscores, trimmed, with its case kept", () => {
    expect([MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH]).toEqual([3, 24]);
    expect(parseUsername("  Ana.B-2_x ")).toBe("Ana.B-2_x");
    expect(parseUsername("abc")).toBe("abc");
    expect(parseUsername("a".repeat(24))).toBe("a".repeat(24));
    for (const bad of ["ab", "a".repeat(25), "ana b", "ana!", "ána", "", 12, null, undefined]) {
      expect(parseUsername(bad)).toBeNull();
    }
  });

  it("is found by its lower case", () => {
    expect(usernameKey("Ana.B")).toBe("ana.b");
  });
});

describe("a password", () => {
  it("is 8 to 128 characters of anything, never trimmed", () => {
    expect([MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH]).toEqual([8, 128]);
    expect(isPassword("12345678")).toBe(true);
    expect(isPassword("  spaced  ")).toBe(true);
    expect(isPassword("x".repeat(128))).toBe(true);
    for (const bad of ["1234567", "x".repeat(129), 12345678, undefined]) {
      expect(isPassword(bad)).toBe(false);
    }
  });
});

describe("a user id on its own", () => {
  it("is shaped as in credentials", () => {
    expect(isUserId(ana.userId)).toBe(true);
    for (const bad of ["short", "../../etc/passwd!", 7, undefined])
      expect(isUserId(bad)).toBe(false);
  });
});

describe("signing in's paths", () => {
  it("are where both hosts answer them", () => {
    expect([CLAIM_PATH, SIGN_IN_PATH, PASSWORD_PATH, SIGN_OUT_PATH]).toEqual([
      "/api/account/claim",
      "/api/account/sign-in",
      "/api/account/password",
      "/api/account/sign-out",
    ]);
  });
});
