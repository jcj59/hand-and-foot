import { describe, it, expect } from "vitest";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@hf/shared";
import { isPossibleRoomCode, normalizeRoomCode, roomLink } from "./roomCode";

describe("normalizeRoomCode", () => {
  it("upper-cases what was typed", () => {
    expect(normalizeRoomCode("abc234")).toBe("ABC234");
  });

  it("drops the separators a person types or pastes", () => {
    expect(normalizeRoomCode(" abc-234 ")).toBe("ABC234");
    expect(normalizeRoomCode("ABC 234")).toBe("ABC234");
  });

  it("leaves an already-clean code alone", () => {
    expect(normalizeRoomCode("ABC234")).toBe("ABC234");
  });

  it("keeps characters it cannot interpret, rather than silently dropping them", () => {
    // They have to survive normalization for the validity check to reject them;
    // stripping them here would turn "ABC23O" into a five-character code and lose
    // the reason it was wrong.
    expect(normalizeRoomCode("abc23o")).toBe("ABC23O");
  });
});

describe("isPossibleRoomCode", () => {
  it("accepts a code of the right length from the right alphabet", () => {
    expect(isPossibleRoomCode("ABC234")).toBe(true);
    expect(isPossibleRoomCode("abc-234")).toBe(true);
  });

  it("rejects anything of the wrong length", () => {
    expect(isPossibleRoomCode("ABC23")).toBe(false);
    expect(isPossibleRoomCode("ABC2345")).toBe(false);
    expect(isPossibleRoomCode("")).toBe(false);
  });

  it.each([..."O0IL1"])("rejects the look-alike character %s", (character) => {
    // The server's alphabet omits these precisely so they never appear in a real
    // code. A player who typed one made a mistake that cannot be corrected, since
    // there is no unambiguous character to map it to — so the code is invalid
    // rather than guessed at, which could send them to a different real table.
    expect(ROOM_CODE_ALPHABET.includes(character)).toBe(false);
    expect(isPossibleRoomCode(`ABC23${character}`)).toBe(false);
  });

  it("rejects punctuation that is not a separator", () => {
    expect(isPossibleRoomCode("ABC23!")).toBe(false);
  });

  it("agrees with the shared alphabet and length", () => {
    // Built from the shared constants rather than a literal, so the check follows
    // the server if the code format ever changes.
    const valid = ROOM_CODE_ALPHABET.slice(0, ROOM_CODE_LENGTH);
    expect(valid).toHaveLength(ROOM_CODE_LENGTH);
    expect(isPossibleRoomCode(valid)).toBe(true);
  });
});

describe("roomLink", () => {
  it("builds a link under the running origin", () => {
    // From the live origin rather than a configured base, so it is right in
    // development, in a preview deployment and in production with nothing to keep
    // in step.
    expect(roomLink("ABC234", "https://handandfoot.example")).toBe(
      "https://handandfoot.example/room/ABC234",
    );
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(roomLink("ABC234", "http://localhost:5173/")).toBe("http://localhost:5173/room/ABC234");
  });

  it("normalizes the code it puts in the link", () => {
    // A link is for sharing; it should carry the canonical code whatever case the
    // caller happened to hold.
    expect(roomLink("abc234", "http://x")).toBe("http://x/room/ABC234");
  });
});
