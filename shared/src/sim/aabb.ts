import type { Vec3 } from "../types";
import { add, rotateY, sub, vec3 } from "./vec3";

/** Axis-aligned bounding box in world space. */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

export const aabbFromCenterSize = (center: Vec3, size: Vec3): AABB => ({
  min: vec3(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2),
  max: vec3(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2),
});

/** Box whose bottom face sits at `base.y` (how the client positions most props). */
export const aabbFromBaseSize = (base: Vec3, size: Vec3): AABB => ({
  min: vec3(base.x - size.x / 2, base.y, base.z - size.z / 2),
  max: vec3(base.x + size.x / 2, base.y + size.y, base.z + size.z / 2),
});

/** World-space AABB enclosing a box of `size` centred at `center`, rotated `angle` about Y. */
export const aabbFromRotatedBox = (
  center: Vec3,
  size: Vec3,
  angle: number
): AABB => {
  const hx = size.x / 2;
  const hz = size.z / 2;
  const corners = [
    rotateY(vec3(hx, 0, hz), angle),
    rotateY(vec3(-hx, 0, hz), angle),
    rotateY(vec3(hx, 0, -hz), angle),
    rotateY(vec3(-hx, 0, -hz), angle),
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }
  return {
    min: vec3(center.x + minX, center.y - size.y / 2, center.z + minZ),
    max: vec3(center.x + maxX, center.y + size.y / 2, center.z + maxZ),
  };
};

export const aabbContains = (box: AABB, p: Vec3): boolean =>
  p.x >= box.min.x &&
  p.x <= box.max.x &&
  p.y >= box.min.y &&
  p.y <= box.max.y &&
  p.z >= box.min.z &&
  p.z <= box.max.z;

export const aabbIntersects = (a: AABB, b: AABB): boolean =>
  a.min.x <= b.max.x &&
  a.max.x >= b.min.x &&
  a.min.y <= b.max.y &&
  a.max.y >= b.min.y &&
  a.min.z <= b.max.z &&
  a.max.z >= b.min.z;

export const aabbCenter = (box: AABB): Vec3 =>
  vec3(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2
  );

/**
 * Sweep the segment `from -> to` against `box` (slab method).
 * Returns the parametric entry time in [0, 1], or null for no hit.
 * A segment starting inside the box hits at t = 0.
 */
export function sweepSegmentAABB(
  from: Vec3,
  to: Vec3,
  box: AABB
): number | null {
  let tMin = 0;
  let tMax = 1;

  const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
  for (const axis of axes) {
    const d = to[axis] - from[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    const start = from[axis];

    if (Math.abs(d) < 1e-12) {
      // Parallel to the slab: must already be inside it.
      if (start < lo || start > hi) return null;
      continue;
    }

    let t1 = (lo - start) / d;
    let t2 = (hi - start) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin;
}

/**
 * Bring a world-space point into the local frame of `box` rotated `yaw`
 * radians about the Y axis through its centre (same convention as a Three.js
 * `rotation.y`). In that frame the rotated box is just `box` again.
 */
const toRotatedBoxFrame = (box: AABB, yaw: number, p: Vec3): Vec3 => {
  const c = aabbCenter(box);
  return add(rotateY(sub(p, c), -yaw), c);
};

/** Whether `p` lies inside `box` after rotating the box `yaw` about Y through its centre. */
export const rotatedAabbContains = (box: AABB, yaw: number, p: Vec3): boolean =>
  aabbContains(box, yaw === 0 ? p : toRotatedBoxFrame(box, yaw, p));

/**
 * Sweep the segment `from -> to` against `box` rotated `yaw` about the Y axis
 * through its centre. Same contract as `sweepSegmentAABB`.
 */
export function sweepSegmentRotatedAABB(
  from: Vec3,
  to: Vec3,
  box: AABB,
  yaw: number
): number | null {
  if (yaw === 0) return sweepSegmentAABB(from, to, box);
  return sweepSegmentAABB(
    toRotatedBoxFrame(box, yaw, from),
    toRotatedBoxFrame(box, yaw, to),
    box
  );
}
