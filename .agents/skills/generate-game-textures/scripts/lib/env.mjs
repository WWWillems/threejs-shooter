import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** `.agents/skills/generate-game-textures` */
export const SKILL_DIR = resolve(here, "..", "..");
/** Repository root (the folder that holds `app/`, `server/`, `shared/`). */
export const REPO_ROOT = resolve(SKILL_DIR, "..", "..", "..");

/**
 * OPENAI_API_KEY from the environment, else from `<repo>/.env` (gitignored).
 * Never read from anywhere else; never log the value.
 */
export function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = resolve(REPO_ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  throw new Error(
    "OPENAI_API_KEY is not set. Export it in your shell or add `OPENAI_API_KEY=...` to <repo>/.env (gitignored)."
  );
}
