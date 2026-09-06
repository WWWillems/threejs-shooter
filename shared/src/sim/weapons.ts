export type WeaponId = "pistol" | "rifle" | "shotgun" | "rocket" | "flamethrower" | "precision" | "arc";

export interface WeaponStats {
  id: WeaponId;
  ammoType: string;
  ammoPickup: number;
  color: number;
  automatic?: boolean;
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
  rocket: { id:"rocket", name:"Rocket Launcher", ammoType:"Rockets", ammoPickup:2, color:0xd88c53,
    fireRate:1.4, damage:120, bulletSpeed:18, range:65, magazineSize:1, reserveAmmo:4, reloadTime:2.8, pellets:1, spreadAngle:0 },
  flamethrower: { id:"flamethrower", name:"Flamethrower", ammoType:"Fuel", ammoPickup:40, color:0xf3b34d, automatic:true,
    fireRate:.08, damage:2, bulletSpeed:18, range:7, magazineSize:80, reserveAmmo:160, reloadTime:2.6, pellets:3, spreadAngle:.12 },
  precision: { id:"precision", name:"Precision Rifle", ammoType:".308 rounds", ammoPickup:8, color:0xb5c1ca,
    fireRate:1.35, damage:85, bulletSpeed:180, range:140, magazineSize:5, reserveAmmo:20, reloadTime:2.5, pellets:1, spreadAngle:0 },
  arc: { id:"arc", name:"Arc Gun", ammoType:"Arc cells", ammoPickup:12, color:0x77d8eb,
    fireRate:.65, damage:32, bulletSpeed:75, range:18, magazineSize:8, reserveAmmo:32, reloadTime:2, pellets:1, spreadAngle:0 },

  pistol: {
    id: "pistol", ammoType: "9mm rounds", ammoPickup: 30, color: 0x6d9fff,
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
    id: "rifle", ammoType: "5.56mm rounds", ammoPickup: 40, color: 0x83ac78, automatic: true,
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
    id: "shotgun", ammoType: "12-gauge shells", ammoPickup: 12, color: 0xd79166,
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

export const WEAPON_IDS: readonly WeaponId[] = ["pistol", "rifle", "shotgun", "rocket", "flamethrower", "precision", "arc"];
export const LOOT_WEAPON_IDS: readonly WeaponId[] = ["rocket", "flamethrower", "precision", "arc"];
export const ROCKET_BLAST_RADIUS = 5.5;
export const rocketBlastDamage = (distance: number): number => Math.max(0, Math.round(WEAPONS.rocket.damage * (1-distance/ROCKET_BLAST_RADIUS)));

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
