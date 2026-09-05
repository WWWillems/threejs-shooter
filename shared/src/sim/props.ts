import type { Vec3 } from '../types';
import { aabbFromRotatedBox, type AABB } from './aabb';

export const PROP_TYPES = ['trash-bag', 'oil-barrel', 'forklift', 'fence', 'fence-gate'] as const;
export type PropType = typeof PROP_TYPES[number];
/** A placed yard prop; `generateMap` owns placement, this module owns collision. */
export interface PropSpec {
  id: string;
  type: PropType;
  /** Ground-based origin, matching the Blender model. */
  position: Vec3;
  rotation: number;
  scale: number;
}

interface PropPart { center: Vec3; size: Vec3 }
/** The mast/body and lowered forks have separate collision heights. */
const PARTS: Record<PropType, readonly PropPart[]> = {
  'trash-bag': [{ center: { x: 0, y: .47, z: 0 }, size: { x: .78, y: .94, z: .64 } }],
  'oil-barrel': [{ center: { x: 0, y: .46, z: 0 }, size: { x: .66, y: .92, z: .66 } }],
  fence: [{ center: { x: 0, y: 1.34, z: 0 }, size: { x: 4.18, y: 2.68, z: .18 } }],
  'fence-gate': [{ center: { x: 0, y: 1.34, z: 0 }, size: { x: 4.18, y: 2.68, z: .24 } }],
  forklift: [
    { center: { x: 0, y: 1.25, z: .04 }, size: { x: 1.76, y: 2.5, z: 2.55 } },
    { center: { x: 0, y: .15, z: -1.98 }, size: { x: 1.06, y: .3, z: 1.46 } },
  ],
};

/** Chain-link is traversable by projectiles; a closed gate blocks walking. */
export const isMovementOnlyProp = (type: PropType): boolean =>
  type === 'trash-bag' || type === 'fence' || type === 'fence-gate';

export function propBoxes(prop: PropSpec): AABB[] {
  const c = Math.cos(prop.rotation), s = Math.sin(prop.rotation), k = prop.scale;
  return PARTS[prop.type].map(({ center, size }) => aabbFromRotatedBox({
    x: prop.position.x + k * (center.x * c + center.z * s),
    y: prop.position.y + k * center.y,
    z: prop.position.z + k * (-center.x * s + center.z * c),
  }, { x: size.x * k, y: size.y * k, z: size.z * k }, prop.rotation));
}
