import * as THREE from "three";
import { GRENADE, type GrenadeKind } from "@threejs-shooter/shared";
import { GRENADE_COLORS } from "./grenadeIcons";

/**
 * The silhouette of each throwable, shared by the grenades in flight
 * (`GrenadeRenderer`) and the loot bundles on the ground (`ThrowablePickup`):
 * frag is a ball, the canister kinds are short cylinders, the molotov a bottle.
 */
export function grenadeGeometry(kind: GrenadeKind): THREE.BufferGeometry {
  switch (kind) {
    case "frag":
      return new THREE.SphereGeometry(GRENADE.radius, 12, 10);
    case "smoke":
    case "flash":
    case "gas":
      return new THREE.CylinderGeometry(GRENADE.radius * 0.7, GRENADE.radius * 0.7, GRENADE.radius * 2.4, 12);
    case "molotov":
      return bottleGeometry();
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled grenade kind: ${String(unhandled)}`);
    }
  }
}

/** Casing material per kind; flash is polished metal, the molotov glass. */
export function grenadeMaterial(kind: GrenadeKind): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: GRENADE_COLORS[kind],
    roughness: kind === "flash" ? 0.35 : kind === "molotov" ? 0.2 : 0.6,
    metalness: kind === "flash" ? 0.6 : 0,
    transparent: kind === "molotov",
    opacity: kind === "molotov" ? 0.85 : 1,
  });
}

/** A bottle: body, shoulder and neck, lathed from a profile. */
function bottleGeometry(): THREE.BufferGeometry {
  const r = GRENADE.radius;
  const profile = [
    new THREE.Vector2(0, -r * 1.4),
    new THREE.Vector2(r * 0.55, -r * 1.4),
    new THREE.Vector2(r * 0.6, r * 0.2),
    new THREE.Vector2(r * 0.35, r * 0.8),
    new THREE.Vector2(r * 0.25, r * 1.5),
    new THREE.Vector2(0, r * 1.5),
  ];
  return new THREE.LatheGeometry(profile, 12);
}
