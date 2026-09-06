/**
 * Data + rendering for the menu's controls list. Each binding renders as a
 * button preview - individual key-cap graphics for keyboard keys, or a small
 * mouse icon for mouse actions - instead of plain text, matching the level
 * editor's `kbd` badge language.
 */

interface KeyboardControlEntry {
  readonly kind: "keys";
  readonly keys: readonly string[];
  readonly label: string;
  /** Short annotation shown after the key caps, e.g. "(hold)". */
  readonly note?: string;
}

interface MouseControlEntry {
  readonly kind: "mouse";
  readonly mouseAction: "move" | "left-click";
  readonly label: string;
}

type ControlEntry = KeyboardControlEntry | MouseControlEntry;

/** Every control binding shown on the main menu, in display order. */
export const CONTROL_ENTRIES: readonly ControlEntry[] = [
  { kind: "keys", keys: ["W", "A", "S", "D"], label: "Move" },
  { kind: "mouse", mouseAction: "move", label: "Aim" },
  { kind: "mouse", mouseAction: "left-click", label: "Shoot" },
  { kind: "keys", keys: ["R"], label: "Reload" },
  { kind: "keys", keys: ["V"], label: "Open gate / release smoke" },
  { kind: "keys", keys: ["F"], label: "Throw grenade" },
  { kind: "keys", keys: ["C"], label: "Cycle throwable: frag, smoke, flash, gas, molotov" },
  { kind: "keys", keys: ["1", "–", "7"], label: "Switch weapons" },
  { kind: "keys", keys: ["Q", "E"], label: "Cycle weapons" },
  { kind: "keys", keys: ["G"], label: "Drop weapon" },
  { kind: "keys", keys: ["Y"], label: "Chat" },
  { kind: "keys", keys: ["Tab"], label: "Leaderboard", note: "(hold)" },
];

/** A mouse silhouette with motion arrows on all four sides, for "Aim". */
function mouseMoveIcon(): string {
  return `
    <svg class="mouse-icon" viewBox="0 0 40 40" aria-hidden="true">
      <path class="mouse-arrow" d="M20 1 L24 8 L16 8 Z" />
      <path class="mouse-arrow" d="M20 39 L24 32 L16 32 Z" />
      <path class="mouse-arrow" d="M1 20 L8 16 L8 24 Z" />
      <path class="mouse-arrow" d="M39 20 L32 16 L32 24 Z" />
      <rect class="mouse-body" x="13" y="9" width="14" height="22" rx="7" />
      <line class="mouse-divider" x1="20" y1="9" x2="20" y2="17" />
      <rect class="mouse-wheel" x="19" y="11" width="2" height="5" rx="1" />
    </svg>
  `;
}

/** The same mouse silhouette with the left button highlighted, for "Shoot". */
function mouseLeftClickIcon(): string {
  return `
    <svg class="mouse-icon" viewBox="0 0 40 40" aria-hidden="true">
      <rect class="mouse-body" x="13" y="9" width="14" height="22" rx="7" />
      <path class="mouse-button-highlight" d="M20 9 V17 H13 V16 A7 7 0 0 1 20 9 Z" />
      <line class="mouse-divider" x1="20" y1="9" x2="20" y2="17" />
      <rect class="mouse-wheel" x="19" y="11" width="2" height="5" rx="1" />
    </svg>
  `;
}

function renderKeyboardEntry(entry: KeyboardControlEntry): string {
  const caps = entry.keys
    .map((key) => `<kbd class="keycap">${key}</kbd>`)
    .join("");
  const note = entry.note
    ? `<span class="control-note">${entry.note}</span>`
    : "";
  return `<span class="control-keys">${caps}${note}</span>`;
}

function renderMouseEntry(entry: MouseControlEntry): string {
  const icon =
    entry.mouseAction === "move" ? mouseMoveIcon() : mouseLeftClickIcon();
  return `<span class="control-keys">${icon}</span>`;
}

function renderEntryKeys(entry: ControlEntry): string {
  switch (entry.kind) {
    case "keys":
      return renderKeyboardEntry(entry);
    case "mouse":
      return renderMouseEntry(entry);
    default: {
      const exhaustiveCheck: never = entry;
      throw new Error(`Unhandled control entry kind: ${exhaustiveCheck}`);
    }
  }
}

function renderEntry(entry: ControlEntry): string {
  return `
    <li class="control-row">
      ${renderEntryKeys(entry)}
      <span class="control-label">${entry.label}</span>
    </li>
  `;
}

/** Renders the full controls list as a `<ul>` markup string. */
export function renderControlsList(): string {
  const rows = CONTROL_ENTRIES.map(renderEntry).join("");
  return `<ul class="controls-list">${rows}</ul>`;
}
