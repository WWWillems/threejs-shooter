/** Maximum number of Unicode code points allowed in a player nickname. */
export const MAX_NICKNAME_LENGTH = 24;

const UNSAFE_NICKNAME_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF<>]/gu;

/**
 * Converts untrusted nickname input into the canonical value used by the
 * server and clients. The server must call this at the join boundary; the
 * client-side call is only for immediate UI feedback.
 */
export function sanitizeNickname(value: unknown): string {
  if (typeof value !== "string") return "Player";

  const nickname = value
    // Bound work on hostile payloads before normalizing the string.
    .slice(0, MAX_NICKNAME_LENGTH * 4)
    .normalize("NFKC")
    .replace(UNSAFE_NICKNAME_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim();

  if (nickname.length === 0) return "Player";

  return Array.from(nickname).slice(0, MAX_NICKNAME_LENGTH).join("");
}
