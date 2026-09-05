import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateMap,
  levelFromMap,
  serializeLevelDocument,
} from "../../shared/src/index.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = resolve(repositoryRoot, "shared/levels/default.json");
const level = levelFromMap(generateMap(), "default", "Default level");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serializeLevelDocument(level), "utf8");
console.log(`Generated ${outputPath}`);
