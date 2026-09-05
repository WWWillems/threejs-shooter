import fs from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

class NodeFileReader {
  result = null;
  onloadend = undefined;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.({ target: this });
    });
  }
}

globalThis.FileReader ??= NodeFileReader;

const root = path.resolve(import.meta.dirname, "../..");
const outputDirectory = path.join(root, "app/public/models");

const material = (name, color, roughness = 0.7, metalness = 0) => {
  const value = new THREE.MeshStandardMaterial({
    name,
    color,
    roughness,
    metalness,
  });
  return value;
};

const materials = {
  brick: material("brick-soot", 0x7a5145, 0.86),
  steel: material("corrugated-rust", 0x77756e, 0.6, 0.45),
  concrete: material("weathered-concrete", 0x8a8880, 0.9),
  black: material("building-shadow", 0x121414, 0.9),
  glass: material("smoked-window-glass", 0x1f2b2f, 0.18, 0.25),
  warning: material("warning-paint", 0xaa7422, 0.52, 0.1),
  rust: material("fire-escape-rust", 0x492b1e, 0.8, 0.25),
};

function addBox(parent, name, position, size, surface, rotation = undefined) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), materials[surface]);
  mesh.name = name;
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, name, position, radius, height, surface, vertices = 16) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, vertices),
    materials[surface]
  );
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addRod(parent, name, start, end, radius, surface, vertices = 8) {
  const first = new THREE.Vector3(...start);
  const second = new THREE.Vector3(...end);
  const direction = second.clone().sub(first);
  const mesh = addCylinder(
    parent,
    name,
    first.clone().add(second).multiplyScalar(0.5).toArray(),
    radius,
    direction.length(),
    surface,
    vertices
  );
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize()
  );
  return mesh;
}

function addWarehouse() {
  const rootObject = new THREE.Group();
  rootObject.name = "Noir warehouse";
  addBox(rootObject, "concrete plinth", [0, 0.15, 0], [14.2, 0.3, 10.2], "concrete");
  addBox(rootObject, "rear wall", [0, 2.8, 4.8], [14, 5.4, 0.28], "steel");
  addBox(rootObject, "left wall", [-6.85, 2.8, 0], [0.3, 5.4, 9.7], "steel");
  addBox(rootObject, "right wall", [6.85, 2.8, 0], [0.3, 5.4, 9.7], "steel");
  addBox(rootObject, "front lintel", [0, 4.75, -4.8], [14, 1.5, 0.3], "steel");
  addBox(rootObject, "front beam", [0, 3.15, -4.83], [14, 0.22, 0.32], "concrete");
  for (const x of [-4.7, 0, 4.7]) {
    addBox(rootObject, "loading bay shadow", [x, 2.25, -5], [3.8, 3.9, 0.06], "black");
    addBox(rootObject, "loading bay header", [x, 4.35, -5.08], [4.1, 0.22, 0.34], "concrete");
    for (const side of [-1, 1]) {
      addBox(rootObject, "loading bay jamb", [x + side * 1.92, 2.25, -5.08], [0.22, 4.1, 0.34], "concrete");
    }
  }
  addBox(rootObject, "loading dock", [0, 0.43, -5.45], [13.5, 0.56, 1], "concrete");
  addBox(rootObject, "dock warning stripe", [0, 0.74, -5.95], [13.4, 0.08, 0.12], "warning");
  for (const x of [-5.6, -4.9, 4.9, 5.6]) {
    addBox(rootObject, "corner warning stripe", [x, 1, -5.02], [0.15, 1.6, 0.08], "warning");
  }
  for (const x of [-4.7, -2.35, 0, 2.35, 4.7]) {
    addBox(rootObject, "roof vent", [x, 4.95, 1.5], [0.72, 0.25, 1.8], "concrete");
    addBox(rootObject, "roof vent cap", [x, 5.14, 1.5], [1, 0.1, 2], "steel");
  }
  for (let index = 0; index < 5; index += 1) {
    addBox(
      rootObject,
      "sawtooth roof",
      [0, 5.35, -4 + index * 2],
      [14.3, 0.16, 2.25],
      "steel",
      [index % 2 === 0 ? 0.18 : -0.18, 0, 0]
    );
  }
  for (const side of [-1, 1]) {
    for (const z of [-3.4, -1.7, 0, 1.7, 3.4]) {
      addRod(rootObject, "side rain gutter", [side * 7.05, 0.7, z], [side * 7.05, 4.7, z], 0.045, "concrete");
    }
  }
  return rootObject;
}

function addFireEscape(parent) {
  for (const y of [2.9, 5.2]) {
    addBox(parent, "fire escape platform", [0, y, -4.35], [5.8, 0.16, 1.35], "steel");
    for (const x of [-2.7, -1.8, -0.9, 0, 0.9, 1.8, 2.7]) {
      addBox(parent, "fire escape grate", [x, y + 0.1, -4.35], [0.07, 0.05, 1.15], "rust");
    }
    for (const x of [-2.75, 2.75]) {
      addRod(parent, "fire escape rail post", [x, y, -4.88], [x, y + 1, -4.88], 0.045, "rust");
    }
    addRod(parent, "fire escape rail", [-2.75, y + 1, -4.88], [2.75, y + 1, -4.88], 0.05, "rust");
  }
  for (let index = 0; index < 7; index += 1) {
    const y = 2.75 + index * 0.4;
    addBox(parent, "fire escape stair", [0, y, -5.05 + index * 0.12], [2.2, 0.08, 0.42], "steel");
  }
}

function addTenement() {
  const rootObject = new THREE.Group();
  rootObject.name = "Noir tenement office";
  addBox(rootObject, "concrete plinth", [0, 0.18, 0], [7.15, 0.36, 8.15], "concrete");
  addBox(rootObject, "brick shell", [0, 3.8, 0], [7, 7.1, 8], "brick");
  addBox(rootObject, "roof cap", [0, 7.48, 0], [7.2, 0.22, 8.2], "concrete");
  addBox(rootObject, "front shadow", [0, 3.2, -4.03], [6.3, 5.7, 0.05], "black");
  for (const floorY of [2.1, 4.45, 6.8]) {
    addBox(rootObject, "front floor band", [0, floorY, -4.1], [7.05, 0.18, 0.16], "concrete");
    for (const x of [-2.55, -0.85, 0.85, 2.55]) {
      addBox(rootObject, "window glass", [x, floorY + 0.82, -4.13], [1.1, 1.35, 0.06], "glass");
      addBox(rootObject, "window sill", [x, floorY + 0.12, -4.2], [1.3, 0.12, 0.24], "concrete");
      for (const side of [-1, 1]) {
        addBox(rootObject, "window jamb", [x + side * 0.62, floorY + 0.82, -4.2], [0.12, 1.55, 0.22], "concrete");
      }
    }
  }
  addBox(rootObject, "entry shadow", [0, 1, -4.14], [1.5, 1.8, 0.06], "black");
  addBox(rootObject, "entry door", [0, 1, -4.19], [1.2, 1.65, 0.08], "steel");
  addBox(rootObject, "entry lintel", [0, 1.95, -4.2], [1.55, 0.16, 0.24], "concrete");
  addBox(rootObject, "sign panel", [0, 6.95, -4.2], [4.9, 0.7, 0.08], "concrete");
  for (const x of [-1.9, -0.95, 0, 0.95, 1.9]) {
    addBox(rootObject, "sign stripe", [x, 6.95, -4.26], [0.5, 0.06, 0.02], "warning");
  }
  for (const side of [-1, 1]) {
    addBox(rootObject, "side pilaster", [side * 3.45, 3.8, -0.1], [0.18, 7, 8.05], "concrete");
  }
  addCylinder(rootObject, "rooftop water tank", [0, 8.05, 0.4], 0.82, 1.2, "steel", 20);
  for (const x of [-0.55, 0.55]) {
    for (const z of [0.05, 0.75]) {
      addRod(rootObject, "water tank leg", [x, 7.48, z], [x, 7.62, z], 0.07, "rust");
    }
  }
  addFireEscape(rootObject);
  return rootObject;
}

async function exportModel(object, name) {
  const exporter = new GLTFExporter();
  const data = await new Promise((resolve, reject) => {
    exporter.parse(
      object,
      resolve,
      reject,
      { binary: true, onlyVisible: true, trs: true }
    );
  });
  await fs.writeFile(path.join(outputDirectory, `${name}.glb`), Buffer.from(data));
  return {
    name,
    vertices: object.children.reduce((sum, child) => sum + child.geometry.attributes.position.count, 0),
    bytes: Buffer.byteLength(data),
  };
}

await fs.mkdir(outputDirectory, { recursive: true });
const exports = [
  await exportModel(addWarehouse(), "noir-warehouse"),
  await exportModel(addTenement(), "noir-tenement"),
];
console.log(JSON.stringify({ exports }, null, 2));
