import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cloneLevelDocument,
  parseLevelDocument,
  serializeLevelDocument,
} from "../../shared/src/index.ts";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: npm run import:level -- <json-file> [level-id]");
}

const source = await readFile(resolve(inputPath), "utf8");
const level = cloneLevelDocument(parseLevelDocument(JSON.parse(source)));
const requestedId = process.argv[3] ?? level.id ?? basename(inputPath, ".json");
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(requestedId)) {
  throw new Error(`Invalid level ID "${requestedId}"`);
}
level.id = requestedId;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = resolve(repositoryRoot, "shared/levels", `${requestedId}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serializeLevelDocument(level), "utf8");
console.log(`Imported ${inputPath} -> ${outputPath}`);
