import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapFromLevel,
  parseLevelDocument,
  type MapLayout,
} from "@threejs-shooter/shared";

const levelsDirectory = fileURLToPath(
  new URL("../../shared/levels/", import.meta.url)
);

export function loadServerLevel(levelId = process.env.LEVEL_ID ?? "default"): MapLayout {
  const path = resolve(levelsDirectory, `${levelId}.json`);
  const source = readFileSync(path, "utf8");
  const level = parseLevelDocument(JSON.parse(source) as unknown);
  return mapFromLevel(level);
}
