import { describe, expect, it } from "vitest";
import { MAX_NICKNAME_LENGTH, sanitizeNickname } from "./nickname";

describe("sanitizeNickname", () => {
  it("normalizes whitespace and removes markup/control characters", () => {
    expect(sanitizeNickname("  <Admin>\u0000\tPlayer  ")).toBe("AdminPlayer");
  });

  it("falls back for empty or non-string input", () => {
    expect(sanitizeNickname(" \u200B ")).toBe("Player");
    expect(sanitizeNickname({ name: "attacker" })).toBe("Player");
  });

  it("limits Unicode code points to the protocol maximum", () => {
    const nickname = sanitizeNickname("😀".repeat(MAX_NICKNAME_LENGTH + 4));

    expect(Array.from(nickname)).toHaveLength(MAX_NICKNAME_LENGTH);
  });
});
