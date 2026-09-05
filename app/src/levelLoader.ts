import {
  mapFromLevel,
  parseLevelDocument,
  type LevelDocument,
  type MapLayout,
} from "@threejs-shooter/shared";

const levelSources = import.meta.glob("../../shared/levels/*.json", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

export function loadClientLevel(
  levelId = import.meta.env.VITE_LEVEL_ID || "default"
): MapLayout {
  return mapFromLevel(loadClientLevelDocument(levelId));
}

export function loadClientLevelDocument(
  levelId = new URLSearchParams(window.location.search).get("level") ||
    import.meta.env.VITE_LEVEL_ID ||
    "default"
): LevelDocument {
  const sourcePath = `../../shared/levels/${levelId}.json`;
  const source = levelSources[sourcePath];
  if (!source) {
    throw new Error(`Level "${levelId}" was not found in shared/levels`);
  }
  return parseLevelDocument(JSON.parse(source) as unknown);
}
