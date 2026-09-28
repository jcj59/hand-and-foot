import { describe, it, expect } from "vitest";
import { DEFAULT_PORT, parseServerEnv, type ServerEnv } from "./env";

/** Unwrap a parse that is expected to succeed, failing loudly with the error if not. */
function parsed(env: Record<string, string | undefined>): ServerEnv {
  const result = parseServerEnv(env);
  if (!result.ok) throw new Error(`expected a valid environment, got: ${result.error}`);
  return result.value;
}

/** The error from a parse that is expected to fail. */
function rejected(env: Record<string, string | undefined>): string {
  const result = parseServerEnv(env);
  if (result.ok) throw new Error("expected the environment to be rejected");
  return result.error;
}

describe("PORT", () => {
  it("falls back to the default when unset", () => {
    expect(parsed({}).port).toBe(DEFAULT_PORT);
  });

  it("defaults to 3000", () => {
    // Pinned as a literal rather than against the constant, which would move
    // with it. The M3 client's dev server points at this number, so changing it
    // is a decision to make deliberately and not a detail to drift.
    expect(DEFAULT_PORT).toBe(3000);
  });

  it("takes a plain port number", () => {
    expect(parsed({ PORT: "8080" }).port).toBe(8080);
  });

  it("allows zero, which asks the OS for a free port", () => {
    // The tests bind this way, and so do some container setups; it is a real
    // choice rather than a missing value.
    expect(parsed({ PORT: "0" }).port).toBe(0);
  });

  it("forgives surrounding whitespace", () => {
    // Compose files and shell exports introduce it without anyone meaning to.
    expect(parsed({ PORT: "  3001 " }).port).toBe(3001);
  });

  it.each([
    ["a letter typed for a digit", "808O"],
    ["trailing junk parseInt would have swallowed", "8080abc"],
    ["an empty value Number would have read as zero", ""],
    ["exponent notation", "1e3"],
    ["hexadecimal", "0x10"],
    ["a negative port", "-1"],
    ["above the top of the port range", "65536"],
  ])("rejects %s", (_why, value) => {
    // Operator configuration is validated, not coerced: silently defaulting
    // would leave whoever deployed this believing they had set a port.
    expect(rejected({ PORT: value })).toMatch(/^PORT must be a whole number from 0 to 65535/);
  });

  it("quotes the offending value in the error, so the typo is visible", () => {
    expect(rejected({ PORT: "808O" })).toContain('"808O"');
  });

  it("accepts the top of the port range", () => {
    expect(parsed({ PORT: "65535" }).port).toBe(65535);
  });
});

describe("HF_CORS_ORIGINS", () => {
  it("leaves origins unrestricted when unset", () => {
    // Matches createServer's default: wide open is the convenience for local play.
    expect(parsed({}).options.cors).toBeUndefined();
  });

  it("treats a blank value as unset", () => {
    // An exported-but-empty variable is hard to tell from a missing one, so it
    // means the same thing rather than "no origins allowed", which would refuse
    // every client.
    expect(parsed({ HF_CORS_ORIGINS: "   " }).options.cors).toBeUndefined();
  });

  it("takes a single origin", () => {
    expect(parsed({ HF_CORS_ORIGINS: "https://handandfoot.example" }).options.cors).toEqual([
      "https://handandfoot.example",
    ]);
  });

  it("splits a comma-separated list and trims each entry", () => {
    // An environment variable cannot hold a list, so this is the only shape
    // available; the client's dev and preview servers are two separate origins.
    expect(
      parsed({ HF_CORS_ORIGINS: "http://localhost:5173, http://localhost:4173" }).options.cors,
    ).toEqual(["http://localhost:5173", "http://localhost:4173"]);
  });

  it("ignores empty entries from a trailing or doubled comma", () => {
    expect(
      parsed({ HF_CORS_ORIGINS: "https://a.example,,https://b.example," }).options.cors,
    ).toEqual(["https://a.example", "https://b.example"]);
  });
});

describe("operational durations", () => {
  it("leaves both unset by default, so the server's own defaults stand", () => {
    // These are operational settings with defaults in RoomManager; the
    // environment only overrides them.
    expect(parsed({}).options.reconnectGraceMs).toBeUndefined();
    expect(parsed({}).options.abandonedRoomMs).toBeUndefined();
  });

  it.each(["HF_RECONNECT_GRACE_MS", "HF_ABANDONED_ROOM_MS"] as const)(
    "treats a blank %s as unset rather than as zero",
    (key) => {
      // Zero here means "no grace at all", which is too sharp a behaviour to
      // arrive from a variable someone exported empty.
      expect(parsed({ [key]: "  " }).options).toEqual(parsed({}).options);
    },
  );

  it("reads a reconnect grace", () => {
    expect(parsed({ HF_RECONNECT_GRACE_MS: "45000" }).options.reconnectGraceMs).toBe(45_000);
  });

  it("reads an abandoned-room threshold", () => {
    expect(parsed({ HF_ABANDONED_ROOM_MS: "600000" }).options.abandonedRoomMs).toBe(600_000);
  });

  it("allows zero, which means no grace at all", () => {
    expect(parsed({ HF_RECONNECT_GRACE_MS: "0" }).options.reconnectGraceMs).toBe(0);
  });

  it.each(["HF_RECONNECT_GRACE_MS", "HF_ABANDONED_ROOM_MS"] as const)(
    "rejects a %s that is not a whole number, naming the variable",
    (key) => {
      const error = rejected({ [key]: "30s" });
      expect(error).toContain(key);
      expect(error).toContain("whole number of milliseconds");
      expect(error).toContain('"30s"');
    },
  );

  it("rejects a negative duration", () => {
    expect(rejected({ HF_ABANDONED_ROOM_MS: "-5" })).toContain("HF_ABANDONED_ROOM_MS");
  });
});

describe("the whole environment", () => {
  it("reads every setting together", () => {
    expect(
      parsed({
        PORT: "8080",
        HF_CORS_ORIGINS: "https://handandfoot.example",
        HF_RECONNECT_GRACE_MS: "30000",
        HF_ABANDONED_ROOM_MS: "900000",
      }),
    ).toEqual({
      port: 8080,
      options: {
        cors: ["https://handandfoot.example"],
        reconnectGraceMs: 30_000,
        abandonedRoomMs: 900_000,
      },
    });
  });

  it("ignores variables it does not read", () => {
    // A container's environment is full of other things.
    expect(parsed({ HOME: "/root", NODE_ENV: "production" })).toEqual(parsed({}));
  });

  it("reports the first bad variable rather than collecting them", () => {
    // Boot stops at the first problem; fixing it surfaces the next.
    expect(rejected({ PORT: "nope", HF_RECONNECT_GRACE_MS: "also-nope" })).toContain("PORT");
  });
});

describe("DATABASE_URL", () => {
  it("is optional: unset or blank keeps rooms in memory", () => {
    expect(parsed({}).databaseUrl).toBeUndefined();
    expect(parsed({ DATABASE_URL: "  " }).databaseUrl).toBeUndefined();
  });

  it("takes a postgres URL in either spelling, trimmed", () => {
    const neon = "postgresql://hf:secret@ep-quiet-sky.us-east-2.aws.neon.tech/hf?sslmode=require";
    expect(parsed({ DATABASE_URL: ` ${neon} ` }).databaseUrl).toBe(neon);
    expect(parsed({ DATABASE_URL: "postgres://localhost/hf" }).databaseUrl).toBe(
      "postgres://localhost/hf",
    );
  });

  it("refuses anything that is not a postgres URL", () => {
    for (const bad of ["mysql://localhost/hf", "localhost:5432/hf", "not a url"]) {
      expect(rejected({ DATABASE_URL: bad })).toBe(
        "DATABASE_URL must be a postgres:// or postgresql:// URL",
      );
    }
  });

  it("never repeats the value in its complaint, since it carries the password", () => {
    const error = rejected({ DATABASE_URL: "mysql://hf:hunter2@db/hf" });
    expect(error).not.toContain("hunter2");
  });
});
