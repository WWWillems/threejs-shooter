export type WeaponId = "pistol" | "rifle" | "shotgun";

export interface WeaponStats {
  id: WeaponId;
  /** Display name. */
  name: string;
  /** Minimum seconds between shots. */
  fireRate: number;
  /** Damage per pellet that connects. */
  damage: number;
  /** Units per second. */
  bulletSpeed: number;
  /** Units a bullet travels before it despawns. */
  range: number;
  magazineSize: number;
  /** Rounds carried outside the magazine at spawn. */
  reserveAmmo: number;
  /** Seconds to reload. */
  reloadTime: number;
  /** Pellets per shot. > 1 means a spread. */
  pellets: number;
  /** Yaw offset between adjacent pellets, radians. */
  spreadAngle: number;
}

export const WEAPONS: Record<WeaponId, WeaponStats> = {
  pistol: {
    id: "pistol",
    name: "Pistol",
    fireRate: 0.4,
    damage: 25,
    bulletSpeed: 30,
    range: 90,
    magazineSize: 12,
    reserveAmmo: 120,
    reloadTime: 1.2,
    pellets: 1,
    spreadAngle: 0,
  },
  rifle: {
    id: "rifle",
    name: "Assault Rifle",
    fireRate: 0.1,
    damage: 25,
    bulletSpeed: 30,
    range: 90,
    magazineSize: 30,
    reserveAmmo: 150,
    reloadTime: 2.0,
    pellets: 1,
    spreadAngle: 0,
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    fireRate: 0.8,
    damage: 25,
    bulletSpeed: 30,
    range: 90,
    magazineSize: 6,
    reserveAmmo: 30,
    reloadTime: 0.5,
    pellets: 3,
    spreadAngle: 0.1,
  },
};

export const WEAPON_IDS: readonly WeaponId[] = ["pistol", "rifle", "shotgun"];

export const isWeaponId = (value: unknown): value is WeaponId =>
  typeof value === "string" && (WEAPON_IDS as readonly string[]).includes(value);

/**
 * Yaw offsets (radians) of each pellet relative to the aim direction, centred
 * on zero: 1 pellet -> [0]; 3 pellets, 0.1 -> [-0.1, 0, 0.1].
 */
export function pelletYawOffsets(weapon: WeaponStats): number[] {
  const offsets: number[] = [];
  const mid = (weapon.pellets - 1) / 2;
  for (let i = 0; i < weapon.pellets; i++) {
    offsets.push((i - mid) * weapon.spreadAngle);
  }
  return offsets;
}
