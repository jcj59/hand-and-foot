import { describe, it, expect } from "vitest";
import type { SeatCredentials } from "@hf/shared";
import {
  browserStore,
  clearCredentials,
  CREDENTIALS_KEY,
  loadCredentials,
  saveCredentials,
  type CredentialStore,
} from "./credentials";

/** An in-memory stand-in for localStorage. */
function memoryStore(initial: Record<string, string> = {}): CredentialStore & {
  readonly data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A store that throws on every operation, like one in a locked-down browser. */
function hostileStore(): CredentialStore {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

const valid: SeatCredentials = { roomId: "ABC123", seat: 2, token: "tok-abc" };

describe("round trip", () => {
  it("reads back exactly what was stored", () => {
    const store = memoryStore();
    saveCredentials(valid, store);
    expect(loadCredentials(store)).toEqual(valid);
  });

  it("stores under a namespaced key", () => {
    // Shared origin with anything else served from the same host in development.
    const store = memoryStore();
    saveCredentials(valid, store);
    expect(Object.keys(store.data)).toEqual([CREDENTIALS_KEY]);
  });

  it("keeps seat 0, which is falsy but a real seat", () => {
    // The host's own seat. A truthiness check anywhere in the validation would
    // silently lose it.
    const store = memoryStore();
    saveCredentials({ ...valid, seat: 0 }, store);
    expect(loadCredentials(store)?.seat).toBe(0);
  });

  it("forgets the seat when cleared", () => {
    const store = memoryStore();
    saveCredentials(valid, store);
    clearCredentials(store);
    expect(loadCredentials(store)).toBeNull();
  });
});

describe("nothing stored", () => {
  it("returns null for an empty store", () => {
    expect(loadCredentials(memoryStore())).toBeNull();
  });

  it("returns null when there is no store at all", () => {
    // A browser blocking site data: playing still works, only recovery is lost.
    expect(loadCredentials(null)).toBeNull();
  });

  it("saving and clearing against no store are silent no-ops", () => {
    expect(() => saveCredentials(valid, null)).not.toThrow();
    expect(() => clearCredentials(null)).not.toThrow();
  });
});

describe("untrusted contents", () => {
  it.each([
    ["not JSON at all", "{{{"],
    ["a JSON string", '"hello"'],
    ["null", "null"],
    ["an array", "[]"],
    ["a number", "12"],
    ["an empty object", "{}"],
    ["a missing token", '{"roomId":"ABC123","seat":0}'],
    ["a missing roomId", '{"seat":0,"token":"t"}'],
    ["a missing seat", '{"roomId":"ABC123","token":"t"}'],
    ["a blank roomId", '{"roomId":"","seat":0,"token":"t"}'],
    ["a blank token", '{"roomId":"ABC123","seat":0,"token":""}'],
    ["a seat that is a string", '{"roomId":"ABC123","seat":"0","token":"t"}'],
    ["a fractional seat", '{"roomId":"ABC123","seat":1.5,"token":"t"}'],
    ["a negative seat", '{"roomId":"ABC123","seat":-1,"token":"t"}'],
  ])("ignores %s", (_why, stored) => {
    // This is a string the user can edit and one that outlives app versions, so a
    // half-populated credentials object must never escape into the store.
    expect(loadCredentials(memoryStore({ [CREDENTIALS_KEY]: stored }))).toBeNull();
  });
});

describe("a storage that throws", () => {
  it("reads as nothing stored", () => {
    expect(loadCredentials(hostileStore())).toBeNull();
  });

  it("swallows a failed write rather than breaking the join", () => {
    // A full quota must not turn a successful join into an error the player sees.
    expect(() => saveCredentials(valid, hostileStore())).not.toThrow();
  });

  it("swallows a failed clear", () => {
    expect(() => clearCredentials(hostileStore())).not.toThrow();
  });
});

describe("browserStore", () => {
  it("returns the real localStorage under jsdom", () => {
    const store = browserStore();
    expect(store).not.toBeNull();
    saveCredentials(valid, store);
    expect(loadCredentials(store)).toEqual(valid);
    clearCredentials(store);
  });

  it("defaults to the browser store when no store is passed", () => {
    // The production call shape, with jsdom standing in for the browser.
    saveCredentials(valid);
    expect(loadCredentials()).toEqual(valid);
    clearCredentials();
    expect(loadCredentials()).toBeNull();
  });

  it("returns null when even reaching for localStorage throws", () => {
    // A browser configured to block site data throws on the property access
    // itself, not on the read, so the guard has to wrap the access. Simulated by
    // replacing the accessor, since jsdom's own storage always works.
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("access denied");
      },
    });
    try {
      expect(browserStore()).toBeNull();
      // And the callers degrade rather than throwing out of a join.
      expect(loadCredentials()).toBeNull();
      expect(() => saveCredentials(valid)).not.toThrow();
      expect(() => clearCredentials()).not.toThrow();
    } finally {
      if (real) Object.defineProperty(window, "localStorage", real);
    }
  });
});
