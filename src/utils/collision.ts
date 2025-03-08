import * as THREE from "three";

/**
 * Check if two 3D boxes are colliding
 */
export function boxesCollide(box1: THREE.Box3, box2: THREE.Box3): boolean {
  return box1.intersectsBox(box2);
}

/**
 * Check if a point is inside a 3D box
 */
export function pointInBox(point: THREE.Vector3, box: THREE.Box3): boolean {
  return box.containsPoint(point);
}

/**
 * Get bounding box for a mesh
 */
export function getBoundingBox(mesh: THREE.Mesh): THREE.Box3 {
  return new THREE.Box3().setFromObject(mesh);
}

/**
 * Check if a ray intersects with objects in the scene
 */
export function raycast(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  objects: THREE.Object3D[],
  maxDistance = Number.POSITIVE_INFINITY
): THREE.Intersection[] | null {
  const raycaster = new THREE.Raycaster(origin, direction, 0, maxDistance);
  return raycaster.intersectObjects(objects);
}

/**
 * Check if a sphere collides with a list of meshes
 */
export function sphereCollision(
  center: THREE.Vector3,
  radius: number,
  objects: THREE.Object3D[]
): THREE.Object3D[] {
  const colliding: THREE.Object3D[] = [];
  const sphere = new THREE.Sphere(center, radius);

  for (const object of objects) {
    if (object instanceof THREE.Mesh) {
      const box = new THREE.Box3().setFromObject(object);
      if (box.intersectsSphere(sphere)) {
        colliding.push(object);
      }
    }
  }

  return colliding;
}
