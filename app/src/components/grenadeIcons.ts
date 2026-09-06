import type { GrenadeKind } from "@threejs-shooter/shared";

/** Short HUD name per grenade kind. */
export const GRENADE_LABELS: Record<GrenadeKind, string> = {
  frag: "Frag",
  smoke: "Smoke",
  flash: "Flash",
  gas: "Gas",
  molotov: "Molotov",
};

/** Casing colour per kind, shared by the HUD icons and the in-world meshes. */
export const GRENADE_COLORS: Record<GrenadeKind, number> = {
  frag: 0x4a5a3a, // olive drab
  smoke: 0x7c8388, // grey steel
  flash: 0xd9d4c7, // bare aluminium
  gas: 0x8a9a2c, // sickly yellow-green
  molotov: 0x9a5a2a, // amber glass
};

const hex = (color: number): string => `#${color.toString(16).padStart(6, "0")}`;

/** 24x24 SVG icon markup for the HUD's throwable slot. */
export function grenadeIcon(kind: GrenadeKind): string {
  const body = hex(GRENADE_COLORS[kind]);
  switch (kind) {
    case "frag":
      return `<svg viewBox="0 0 24 24" width="40" height="40">
        <circle cx="12" cy="13" r="7" fill="${body}" stroke="#2c3620" stroke-width="1.5" />
        <path d="M9 7 L11 4 L14 4.5" stroke="#8a8a8a" stroke-width="1.5" fill="none" stroke-linecap="round" />
        <circle cx="14" cy="4" r="1.4" fill="#c0392b" />
      </svg>`;
    case "smoke":
      return `<svg viewBox="0 0 24 24" width="40" height="40">
        <rect x="8" y="6" width="8" height="14" rx="2" fill="${body}" stroke="#3a3f43" stroke-width="1.5" />
        <rect x="9.5" y="3.5" width="5" height="3" rx="1" fill="#4a4f53" />
        <path d="M6 5 C4 3, 5 1, 7 1.5 M17 4 C19.5 2.5, 20 5, 18.5 6" stroke="#b9bfc4" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.8" />
        <rect x="9.5" y="11" width="5" height="3" fill="#d8d8d8" opacity="0.7" />
      </svg>`;
    case "flash":
      return `<svg viewBox="0 0 24 24" width="40" height="40">
        <rect x="8.5" y="5" width="7" height="14" rx="3.5" fill="${body}" stroke="#7a7770" stroke-width="1.5" />
        <rect x="10" y="2.5" width="4" height="3" rx="1" fill="#5a5a5a" />
        <path d="M12 8 L10.5 12.5 L13 12.5 L11.5 17" stroke="#f3e27a" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M3 6 L5 7.5 M21 6 L19 7.5 M3 18 L5 16.5 M21 18 L19 16.5" stroke="#fff5b0" stroke-width="1.2" stroke-linecap="round" />
      </svg>`;
    case "gas":
      return `<svg viewBox="0 0 24 24" width="40" height="40">
        <rect x="8" y="6" width="8" height="14" rx="2" fill="${body}" stroke="#4d5716" stroke-width="1.5" />
        <rect x="9.5" y="3.5" width="5" height="3" rx="1" fill="#4a4f2a" />
        <circle cx="12" cy="13" r="2.6" fill="none" stroke="#1d2410" stroke-width="1.3" />
        <path d="M12 10.4 V15.6 M9.75 11.7 L14.25 14.3 M9.75 14.3 L14.25 11.7" stroke="#1d2410" stroke-width="1.1" />
        <circle cx="12" cy="13" r="1.1" fill="#1d2410" />
      </svg>`;
    case "molotov":
      return `<svg viewBox="0 0 24 24" width="40" height="40">
        <path d="M10 9 L10 6 L14 6 L14 9 C16 10, 16.5 12, 16.5 14 L16.5 19 C16.5 20.5 15.5 21.5 14 21.5 L10 21.5 C8.5 21.5 7.5 20.5 7.5 19 L7.5 14 C7.5 12, 8 10, 10 9 Z" fill="${body}" stroke="#4a2a12" stroke-width="1.3" stroke-linejoin="round" />
        <rect x="8.2" y="15" width="7.6" height="4" fill="#d9c9a5" opacity="0.55" />
        <path d="M10.5 6 L13.5 6 L13.5 3.8 L10.5 3.8 Z" fill="#e6dcc4" />
        <path d="M12 4 C10.2 2.6, 10.6 0.8, 12.2 0.4 C11.6 1.6, 12.6 2.2, 13.2 1.2 C14.2 2.4, 13.6 3.6, 12 4 Z" fill="#f3a03a" />
        <path d="M12.1 3.4 C11.3 2.7, 11.6 1.9, 12.3 1.6 C12.2 2.2, 12.8 2.4, 12.9 2.6 C13.1 3.1, 12.7 3.4, 12.1 3.4 Z" fill="#ffe08a" />
      </svg>`;
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled grenade kind: ${String(unhandled)}`);
    }
  }
}
