import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  BUSH_SIZE,
  CAR_SIZE,
  CONE_SIZE,
  SHOP_SIZE,
  STREET_LIGHT_SIZE,
  TENEMENT_SIZE,
  TREE_TRUNK_SIZE,
  WAREHOUSE_SIZE,
  type LevelDocument,
  type LevelObject,
  type LevelObjectType,
  type LevelTransform,
  LEVEL_OBJECT_TYPES,
  cloneLevelDocument,
  levelObjectLabel,
  parseLevelDocument,
  serializeLevelDocument,
  validateLevel,
} from "@threejs-shooter/shared";
import { addYardProp } from "../components/YardProp";
import { Building } from "../components/Building";
import { Bush } from "../components/Bush";
import { Car } from "../components/Car";
import { ShopBuilding } from "../components/ShopBuilding";
import { StreetLight } from "../components/StreetLight";
import { TrafficCone } from "../components/TrafficCone";
import { Tree } from "../components/Tree";
import { WoodenCrate } from "../components/WoodenCrate";
import { loadClientLevelDocument } from "../levelLoader";

type PaletteType = LevelObjectType | "spawn-point";

interface SelectionEntry {
  id: string;
  type: PaletteType;
  transform: LevelTransform;
}

const PALETTE_TYPES: PaletteType[] = [...LEVEL_OBJECT_TYPES, "spawn-point"];
const GIZMO_SIZE = 0.5;
// TransformControls scales its handles to (cameraFrustumOrDistanceFactor * size / 4), so a
// fixed `size` renders at a wildly different world-space extent depending on zoom/camera type.
// We instead target a world-space ring radius relative to the selected object's bounding
// sphere, then solve for the `size` that produces it under that same internal formula.
const GIZMO_RING_BASE_RADIUS = 0.5;
const GIZMO_RING_RADIUS_RATIO = 1.3;
const GIZMO_MIN_RING_RADIUS = 0.4;
const GIZMO_MAX_RING_RADIUS = 3.5;
const GIZMO_MIN_SIZE = 0.08;
const GIZMO_MAX_SIZE = 2.5;
const ORTHO_HALF_HEIGHT = 35;

const defaultTransform = (
  type: LevelObjectType,
  position: THREE.Vector3
): LevelTransform => {
  const positionValue = { x: position.x, y: position.y, z: position.z };
  switch (type) {
    case "wall":
      return {
        position: positionValue,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 8, y: 2.5, z: 0.5 },
      };
    case "shop":
      return {
        position: positionValue,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    case "warehouse":
    case "tenement":
      return {
        position: positionValue,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    case "crate":
      return {
        position: { x: position.x, y: 0.5, z: position.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    case "traffic-cone":
      return {
        position: positionValue,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    case "fence":
    case "fence-gate":
    case "trash-bag":
    case "oil-barrel":
    case "forklift":
    case "car":
    case "street-light":
    case "tree":
    case "bush":
      return {
        position: positionValue,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    default: {
      const unhandled: never = type;
      throw new Error(`Unhandled palette type: ${String(unhandled)}`);
    }
  }
};

function newId(type: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${type}-${suffix}`;
}

export class EditorApp {
  private readonly shell: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly thumbnailRenderer: THREE.WebGLRenderer;
  private readonly thumbnailLoader = new GLTFLoader();
  private readonly thumbnailCache = new Map<PaletteType, string>();
  private readonly thumbnailInFlight = new Set<PaletteType>();
  private readonly thumbnailFailed = new Set<PaletteType>();
  private thumbnailQueue: Promise<void> = Promise.resolve();
  private readonly orthographicCamera: THREE.OrthographicCamera;
  private readonly perspectiveCamera: THREE.PerspectiveCamera;
  private readonly orthographicControls: OrbitControls;
  private readonly perspectiveControls: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground: THREE.Mesh;
  private readonly previewObjects = new Map<string, THREE.Object3D>();
  private readonly selectionHelpers = new Map<string, THREE.BoxHelper>();
  private readonly selection = new Set<string>();
  private readonly history: LevelDocument[] = [];
  private readonly redoHistory: LevelDocument[] = [];
  private readonly objectBrowser: HTMLDivElement;
  private readonly inspector: HTMLDivElement;
  private readonly validation: HTMLDivElement;
  private readonly selectionList: HTMLUListElement;
  private readonly search: HTMLInputElement;
  private level: LevelDocument;
  private activeCamera: THREE.Camera;
  private activeControls: OrbitControls;
  private placementType: PaletteType | null = null;
  private placementGhost?: THREE.Object3D;
  private dragging = false;
  private dragStart = new THREE.Vector2();
  private selectionRectangle?: HTMLDivElement;
  private transformCheckpointTaken = false;

  constructor(container: HTMLElement, level = loadClientLevelDocument()) {
    this.level = cloneLevelDocument(level);
    this.shell = document.createElement("div");
    this.shell.className = "editor-shell";
    this.shell.innerHTML = `
      <div class="editor-viewport"></div>
      <header class="editor-topbar">
        <div class="topbar-brand">
          <span class="brand-glyph">◆</span>
          <span class="level-name"></span>
        </div>
        <div class="toolbar-divider"></div>
        <div class="toolbar-group" role="group" aria-label="History">
          <button data-action="undo" title="Undo (Ctrl/Cmd+Z)"><kbd>⌘Z</kbd>Undo</button>
          <button data-action="redo" title="Redo (Ctrl/Cmd+Shift+Z)"><kbd>⇧⌘Z</kbd>Redo</button>
        </div>
        <div class="toolbar-divider"></div>
        <div class="toolbar-group" role="group" aria-label="Transform mode">
          <button data-action="mode" data-mode="translate" title="Move (W)"><kbd>W</kbd>Move</button>
          <button data-action="mode" data-mode="rotate" title="Rotate (E)"><kbd>E</kbd>Rotate</button>
          <button data-action="mode" data-mode="scale" title="Scale (R)"><kbd>R</kbd>Scale</button>
        </div>
        <div class="toolbar-divider"></div>
        <div class="toolbar-group" role="group" aria-label="Camera">
          <button data-action="camera" title="Toggle camera projection">Perspective</button>
        </div>
        <div class="topbar-spacer"></div>
        <div class="toolbar-group" role="group" aria-label="Level">
          <button data-action="export" title="Save level as JSON (Ctrl/Cmd+S)"><kbd>⌘S</kbd>Save</button>
          <button data-action="import" title="Import a level JSON file">Import</button>
          <button class="primary" data-action="playtest" title="Open the level in Playtest mode">▶ Playtest</button>
        </div>
        <input class="file-input" type="file" accept="application/json,.json" hidden />
      </header>
      <aside class="editor-panel panel-objects">
        <div class="panel-header"><span>Objects</span></div>
        <div class="panel-body">
          <input class="editor-search" placeholder="Search objects…" />
          <div class="object-browser"></div>
        </div>
      </aside>
      <aside class="editor-panel panel-inspector">
        <div class="panel-section">
          <div class="panel-header"><span>Selection</span></div>
          <ul class="selection-list"></ul>
        </div>
        <div class="panel-section panel-section-grow">
          <div class="panel-header"><span>Inspector</span></div>
          <div class="inspector"></div>
        </div>
        <div class="panel-section">
          <div class="validation"></div>
        </div>
      </aside>
      <footer class="editor-statusbar">
        <span class="editor-hint">
          Click a palette item, then click the grid to place it · Shift-click selects multiple ·
          Drag empty space to marquee-select · Delete removes selection
        </span>
      </footer>
    `;
    container.replaceChildren(this.shell);
    this.viewport = this.shell.querySelector(".editor-viewport") as HTMLDivElement;
    this.objectBrowser = this.shell.querySelector(".object-browser") as HTMLDivElement;
    this.inspector = this.shell.querySelector(".inspector") as HTMLDivElement;
    this.validation = this.shell.querySelector(".validation") as HTMLDivElement;
    this.selectionList = this.shell.querySelector(".selection-list") as HTMLUListElement;
    this.search = this.shell.querySelector(".editor-search") as HTMLInputElement;

    this.scene.background = new THREE.Color(0x101216);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.setSize(this.viewport.clientWidth, this.viewport.clientHeight);
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-label", "Level editor viewport");
    this.viewport.append(this.canvas);
    this.thumbnailRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.thumbnailRenderer.setPixelRatio(1);
    this.thumbnailRenderer.setSize(96, 64, false);

    const aspect = this.viewport.clientWidth / this.viewport.clientHeight;
    this.orthographicCamera = new THREE.OrthographicCamera(
      -ORTHO_HALF_HEIGHT * aspect,
      ORTHO_HALF_HEIGHT * aspect,
      ORTHO_HALF_HEIGHT,
      -ORTHO_HALF_HEIGHT,
      0.1,
      500
    );
    this.orthographicCamera.position.set(34, 42, 34);
    this.orthographicCamera.lookAt(0, 0, 0);
    this.perspectiveCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
    this.perspectiveCamera.position.set(34, 34, 34);
    this.perspectiveCamera.lookAt(0, 0, 0);
    this.activeCamera = this.orthographicCamera;
    this.orthographicControls = new OrbitControls(
      this.orthographicCamera,
      this.canvas
    );
    this.perspectiveControls = new OrbitControls(
      this.perspectiveCamera,
      this.canvas
    );
    this.configureCameraControls(this.orthographicControls);
    this.configureCameraControls(this.perspectiveControls);
    this.orthographicControls.target.set(0, 0, 0);
    this.perspectiveControls.target.set(0, 0, 0);
    this.perspectiveControls.enabled = false;
    this.activeControls = this.orthographicControls;

    this.transformControls = new TransformControls(
      this.activeCamera,
      this.canvas
    );
    this.transformControls.setSize(GIZMO_SIZE);
    this.transformControls.setMode("translate");
    this.scene.add(this.transformControls.getHelper());
    this.transformControls.addEventListener("objectChange", () => {
      this.readTransformFromSelection();
      this.updateInspector();
      this.updateValidation();
    });
    this.transformControls.addEventListener("mouseDown", () => {
      if (!this.transformCheckpointTaken) {
        this.pushHistory();
        this.transformCheckpointTaken = true;
      }
    });
    this.transformControls.addEventListener("mouseUp", () => {
      this.transformCheckpointTaken = false;
      this.renderSelectionHelpers();
    });
    this.transformControls.addEventListener("dragging-changed", (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      this.activeControls.enabled = !dragging;
    });

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.level.groundSize, this.level.groundSize),
      new THREE.MeshStandardMaterial({
        color: 0x252a2e,
        roughness: 0.92,
        metalness: 0.05,
      })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.userData.editorGround = true;
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(this.level.groundSize, this.level.groundSize, 0x62605b, 0x34383d);
    grid.position.y = 0.01;
    this.scene.add(grid);

    const hemi = new THREE.HemisphereLight(0xb8c7df, 0x201a16, 1.5);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffd4aa, 2.3);
    key.position.set(22, 40, 16);
    key.castShadow = true;
    this.scene.add(key);

    this.bindUI();
    this.bindViewport();
    this.renderLevel();
    this.animate();
  }

  private bindUI(): void {
    this.shell.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const actionButton = target.closest<HTMLButtonElement>("button[data-action]");
      if (actionButton) {
        this.handleAction(actionButton.dataset.action, actionButton.dataset.mode);
        return;
      }
      const paletteButton = target.closest<HTMLButtonElement>("button[data-object-type]");
      if (paletteButton) {
        const type = paletteButton.dataset.objectType as PaletteType | undefined;
        if (type) this.setPlacementType(type);
      }
    });
    this.search.addEventListener("input", () => this.updateObjectBrowser());
    const fileInput = this.shell.querySelector(".file-input") as HTMLInputElement;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) this.importFile(file);
      fileInput.value = "";
    });
    window.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        this.redo();
      } else if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.exportLevel();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        this.deleteSelection();
      } else if (event.key.toLowerCase() === "w") {
        this.setTransformMode("translate");
      } else if (event.key.toLowerCase() === "e") {
        this.setTransformMode("rotate");
      } else if (event.key.toLowerCase() === "r") {
        this.setTransformMode("scale");
      } else if (event.key === "Escape") {
        this.setPlacementType(null);
        this.select([]);
      }
    });
    window.addEventListener("resize", this.handleResize);
  }

  private configureCameraControls(controls: OrbitControls): void {
    controls.mouseButtons.LEFT = -1 as THREE.MOUSE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
  }

  private handleResize = (): void => {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (width === 0 || height === 0) return;
    const aspect = width / height;
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.orthographicCamera.left = -ORTHO_HALF_HEIGHT * aspect;
    this.orthographicCamera.right = ORTHO_HALF_HEIGHT * aspect;
    this.orthographicCamera.top = ORTHO_HALF_HEIGHT;
    this.orthographicCamera.bottom = -ORTHO_HALF_HEIGHT;
    this.orthographicCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private bindViewport(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      this.dragStart.set(event.clientX, event.clientY);
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.placementType) {
        this.updatePlacementGhost(event.clientX, event.clientY);
      }
      if (!this.dragging) return;
      const distance = this.dragStart.distanceTo(
        new THREE.Vector2(event.clientX, event.clientY)
      );
      if (distance < 6) return;
      this.showSelectionRectangle(event.clientX, event.clientY);
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.canvas.releasePointerCapture(event.pointerId);
      const distance = this.dragStart.distanceTo(
        new THREE.Vector2(event.clientX, event.clientY)
      );
      const additive = event.shiftKey;
      if (distance >= 6) {
        this.selectRectangle(event.clientX, event.clientY, additive);
      } else {
        this.handleClick(event.clientX, event.clientY, additive);
      }
      this.removeSelectionRectangle();
    });
    this.canvas.addEventListener("pointerenter", (event) => {
      if (this.placementType) {
        this.updatePlacementGhost(event.clientX, event.clientY);
      }
    });
    window.addEventListener("pointermove", (event) => {
      if (!this.placementType) return;
      const rect = this.canvas.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }
      this.updatePlacementGhost(event.clientX, event.clientY);
    });
  }

  private handleAction(action: string | undefined, mode: string | undefined): void {
    switch (action) {
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
      case "mode":
        if (mode) this.setTransformMode(mode);
        break;
      case "camera":
        this.toggleCamera();
        break;
      case "export":
        this.exportLevel();
        break;
      case "import":
        (this.shell.querySelector(".file-input") as HTMLInputElement).click();
        break;
      case "playtest":
        this.playtest();
        break;
      default:
        break;
    }
  }

  private setTransformMode(mode: string): void {
    if (mode !== "translate" && mode !== "rotate" && mode !== "scale") return;
    this.transformControls.setMode(mode);
    this.shell.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
  }

  private toggleCamera(): void {
    const usePerspective = this.activeCamera === this.orthographicCamera;
    this.activeCamera = usePerspective
      ? this.perspectiveCamera
      : this.orthographicCamera;
    this.activeControls.enabled = false;
    this.activeControls = usePerspective
      ? this.perspectiveControls
      : this.orthographicControls;
    this.activeControls.enabled = true;
    this.transformControls.camera = this.activeCamera;
    const button = this.shell.querySelector<HTMLButtonElement>('button[data-action="camera"]');
    if (button) button.textContent = usePerspective ? "Isometric" : "Perspective";
  }

  private updatePointer(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
  }

  private handleClick(clientX: number, clientY: number, additive: boolean): void {
    this.updatePointer(clientX, clientY);
    if (this.placementType) {
      const groundHit = this.raycaster.intersectObject(this.ground, false)[0];
      if (groundHit) {
        this.placeAt(this.snapPosition(groundHit.point));
        return;
      }
    }
    const hits = this.raycaster.intersectObjects(
      [...this.previewObjects.values()],
      true
    );
    const hit = hits.find((entry) => !entry.object.userData.editorHelper);
    if (!hit) {
      if (!additive) this.select([]);
      return;
    }
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.editorId) object = object.parent;
    const id = object?.userData.editorId as string | undefined;
    if (id) this.select([id], additive);
  }

  private snapPosition(point: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(Math.round(point.x), 0, Math.round(point.z));
  }

  private placeAt(position: THREE.Vector3): void {
    if (!this.placementType) return;
    this.pushHistory();
    if (this.placementType === "spawn-point") {
      this.level.spawnPoints.push({
        id: newId("spawn"),
        position: { x: position.x, y: 1, z: position.z },
      });
    } else {
      if (
        this.placementType === "shop" &&
        this.level.objects.some((object) => object.type === "shop")
      ) {
        this.setPlacementType(null);
        return;
      }
      const object: LevelObject = {
        id: newId(this.placementType),
        type: this.placementType,
        transform: defaultTransform(this.placementType, position),
      };
      this.level.objects.push(object);
      this.select([object.id]);
    }
    this.renderLevel();
    this.updateValidation();
  }

  private renderLevel(): void {
    this.transformControls.detach();
    for (const object of this.previewObjects.values()) this.scene.remove(object);
    for (const helper of this.selectionHelpers.values()) this.scene.remove(helper);
    this.previewObjects.clear();
    this.selectionHelpers.clear();

    for (const object of this.level.objects) {
      const visual = this.createVisual(object);
      visual.userData.editorId = object.id;
      visual.userData.editorType = object.type;
      this.previewObjects.set(object.id, visual);
    }
    for (const spawn of this.level.spawnPoints) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.06, 16),
        new THREE.MeshBasicMaterial({ color: 0x72c5d8 })
      );
      marker.position.set(spawn.position.x, 0.05, spawn.position.z);
      marker.userData.editorId = spawn.id;
      marker.userData.editorType = "spawn-point";
      this.scene.add(marker);
      this.previewObjects.set(spawn.id, marker);
    }
    this.renderSelectionHelpers();
    this.updateObjectBrowser();
    this.updateInspector();
    this.updateValidation();
  }

  private setPlacementType(type: PaletteType | null): void {
    this.placementType = type;
    this.placementGhost?.parent?.remove(this.placementGhost);
    this.placementGhost = undefined;
    if (type) {
      this.placementGhost = this.createPlacementGhost(type);
      this.placementGhost.userData.editorHelper = true;
      this.placementGhost.visible = false;
      this.scene.add(this.placementGhost);
    }
    this.updateObjectBrowser();
  }

  private createPlacementGhost(type: PaletteType): THREE.Object3D {
    const ghost = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: 0xd6a15f,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      wireframe: true,
    });
    const addBox = (size: THREE.Vector3, y: number): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
      mesh.position.y = y;
      ghost.add(mesh);
    };
    const gridMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xd6a15f,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    gridMarker.rotation.x = -Math.PI / 2;
    gridMarker.position.y = 0.02;
    gridMarker.userData.editorHelper = true;
    ghost.add(gridMarker);

    switch (type) {
      case "fence":
      case "fence-gate":
        addBox(new THREE.Vector3(4.18, 2.68, .24), 1.34);
        break;
      case "wall":
        addBox(new THREE.Vector3(8, 2.5, 0.5), 1.25);
        break;
      case "shop":
        addBox(new THREE.Vector3(SHOP_SIZE.x, SHOP_SIZE.y, SHOP_SIZE.z), SHOP_SIZE.y / 2);
        break;
      case "warehouse":
        addBox(
          new THREE.Vector3(WAREHOUSE_SIZE.x, WAREHOUSE_SIZE.y, WAREHOUSE_SIZE.z),
          WAREHOUSE_SIZE.y / 2
        );
        break;
      case "tenement":
        addBox(
          new THREE.Vector3(TENEMENT_SIZE.x, TENEMENT_SIZE.y, TENEMENT_SIZE.z),
          TENEMENT_SIZE.y / 2
        );
        break;
      case "car":
        addBox(new THREE.Vector3(CAR_SIZE.x, CAR_SIZE.y, CAR_SIZE.z), CAR_SIZE.y / 2);
        break;
      case "street-light":
        addBox(
          new THREE.Vector3(STREET_LIGHT_SIZE.x, STREET_LIGHT_SIZE.y, STREET_LIGHT_SIZE.z),
          STREET_LIGHT_SIZE.y / 2
        );
        break;
      case "crate":
        addBox(new THREE.Vector3(1, 1, 1), 0.5);
        break;
      case "traffic-cone": {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(CONE_SIZE.x / 2, CONE_SIZE.y, 16),
          material
        );
        cone.position.y = CONE_SIZE.y / 2;
        ghost.add(cone);
        break;
      }
      case "tree": {
        const tree = new THREE.Mesh(
          new THREE.ConeGeometry(1.3, TREE_TRUNK_SIZE.y * 3, 10),
          material
        );
        tree.position.y = TREE_TRUNK_SIZE.y * 1.5;
        ghost.add(tree);
        break;
      }
      case "bush": {
        const bush = new THREE.Mesh(
          new THREE.SphereGeometry(BUSH_SIZE.x / 2, 12, 8),
          material
        );
        bush.position.y = BUSH_SIZE.y / 2;
        ghost.add(bush);
        break;
      }
      case "trash-bag":
      case "oil-barrel":
        addBox(new THREE.Vector3(1, 1, 1), 0.5);
        break;
      case "forklift":
        addBox(new THREE.Vector3(2, 2.5, 3), 1.25);
        break;
      case "spawn-point": {
        const spawn = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.35, 0.06, 16),
          material
        );
        spawn.position.y = 0.05;
        ghost.add(spawn);
        break;
      }
      default: {
        const unhandled: never = type;
        throw new Error(`Unhandled placement type: ${String(unhandled)}`);
      }
    }
    return ghost;
  }

  private updatePlacementGhost(clientX: number, clientY: number): void {
    if (!this.placementGhost) return;
    this.updatePointer(clientX, clientY);
    const groundHit = this.raycaster.intersectObject(this.ground, false)[0];
    if (!groundHit) {
      this.placementGhost.visible = false;
      return;
    }
    const position = this.snapPosition(groundHit.point);
    this.placementGhost.visible = true;
    this.placementGhost.position.set(position.x, 0, position.z);
  }

  private createVisual(object: LevelObject): THREE.Object3D {
    const { position, rotation, scale } = object.transform;
    const vector = new THREE.Vector3(position.x, position.y, position.z);
    let visual: THREE.Object3D;
    switch (object.type) {
      case "fence":
      case "fence-gate":
      case "trash-bag":
      case "oil-barrel":
      case "forklift":
        visual = addYardProp(this.scene, object.type, vector);
        visual.scale.set(scale.x, scale.y, scale.z);
        break;
      case "wall": {
        visual = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({
            color: 0x7d8184,
            roughness: 0.8,
          })
        );
        visual.position.copy(vector);
        visual.scale.copy(new THREE.Vector3(scale.x, scale.y, scale.z));
        break;
      }
      case "shop": {
        const shop = new ShopBuilding(vector, this.scene);
        visual = shop.getObject3D();
        visual.scale.copy(new THREE.Vector3(scale.x, scale.y, scale.z));
        break;
      }
      case "warehouse":
      case "tenement": {
        const building = new Building(object.type, vector, this.scene);
        visual = building.getObject3D();
        visual.scale.copy(new THREE.Vector3(scale.x, scale.y, scale.z));
        break;
      }
      case "car":
        visual = Car.addToScene(this.scene, vector);
        break;
      case "street-light":
        visual = StreetLight.addToScene(this.scene, vector);
        break;
      case "crate":
        visual = WoodenCrate.addToScene(
          this.scene,
          vector,
          1,
          rotation.y,
          object.id
        );
        break;
      case "traffic-cone": {
        const cone = new TrafficCone(vector, this.scene, rotation.y);
        visual = cone.getObject3D();
        break;
      }
      case "tree": {
        const tree = new Tree(vector, this.scene, rotation.y, scale.x);
        visual = tree.getObject3D();
        break;
      }
      case "bush": {
        const bush = new Bush(vector, this.scene, rotation.y);
        visual = bush.getObject3D();
        break;
      }
      default: {
        const unhandled: never = object.type;
        throw new Error(`Unhandled editor object type: ${String(unhandled)}`);
      }
    }
    if (
      object.type === "car" ||
      object.type === "street-light" ||
      object.type === "crate" ||
      object.type === "traffic-cone" ||
      object.type === "bush"
    ) {
      visual.scale.multiply(new THREE.Vector3(scale.x, scale.y, scale.z));
    }
    visual.rotation.set(rotation.x, rotation.y, rotation.z);
    return visual;
  }

  private renderSelectionHelpers(): void {
    for (const helper of this.selectionHelpers.values()) this.scene.remove(helper);
    this.selectionHelpers.clear();
    for (const id of this.selection) {
      const object = this.previewObjects.get(id);
      if (!object) continue;
      const helper = new THREE.BoxHelper(object, 0xd6a15f);
      helper.userData.editorHelper = true;
      this.scene.add(helper);
      this.selectionHelpers.set(id, helper);
    }
    const primary = this.primarySelection();
    if (primary) {
      this.updateGizmoSize(primary);
      this.transformControls.attach(primary);
    } else {
      this.transformControls.detach();
    }
  }

  private updateGizmoSize(object: THREE.Object3D): void {
    const bounds = new THREE.Box3().setFromObject(object);
    const sphereRadius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const ringRadius = THREE.MathUtils.clamp(
      Math.max(sphereRadius, 0.1) * GIZMO_RING_RADIUS_RATIO,
      GIZMO_MIN_RING_RADIUS,
      GIZMO_MAX_RING_RADIUS
    );
    const screenFactor = this.gizmoScreenFactor(object);
    const size = (ringRadius / GIZMO_RING_BASE_RADIUS) * (4 / screenFactor);
    this.transformControls.setSize(
      THREE.MathUtils.clamp(size, GIZMO_MIN_SIZE, GIZMO_MAX_SIZE)
    );
  }

  /**
   * Mirrors the internal scale factor TransformControls applies to its handles
   * (see three/examples/jsm/controls/TransformControls.js), so we can solve for the
   * `size` that yields a specific world-space gizmo extent for the active camera.
   */
  private gizmoScreenFactor(object: THREE.Object3D): number {
    const camera = this.activeCamera;
    if (camera instanceof THREE.OrthographicCamera) {
      return (camera.top - camera.bottom) / camera.zoom;
    }
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const worldPosition = object.getWorldPosition(new THREE.Vector3());
    const cameraPosition = perspectiveCamera.getWorldPosition(new THREE.Vector3());
    return (
      worldPosition.distanceTo(cameraPosition) *
      Math.min(
        (1.9 * Math.tan((Math.PI * perspectiveCamera.fov) / 360)) / perspectiveCamera.zoom,
        7
      )
    );
  }

  private primarySelection(): THREE.Object3D | undefined {
    const id = this.selection.values().next().value as string | undefined;
    return id ? this.previewObjects.get(id) : undefined;
  }

  private select(ids: string[], additive = false): void {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.renderSelectionHelpers();
    this.updateInspector();
    this.updateObjectBrowser();
  }

  private showSelectionRectangle(clientX: number, clientY: number): void {
    if (!this.selectionRectangle) {
      this.selectionRectangle = document.createElement("div");
      this.selectionRectangle.className = "selection-rectangle";
      this.shell.append(this.selectionRectangle);
    }
    const left = Math.min(this.dragStart.x, clientX);
    const top = Math.min(this.dragStart.y, clientY);
    this.selectionRectangle.style.left = `${left}px`;
    this.selectionRectangle.style.top = `${top}px`;
    this.selectionRectangle.style.width = `${Math.abs(clientX - this.dragStart.x)}px`;
    this.selectionRectangle.style.height = `${Math.abs(clientY - this.dragStart.y)}px`;
  }

  private removeSelectionRectangle(): void {
    this.selectionRectangle?.remove();
    this.selectionRectangle = undefined;
  }

  private selectRectangle(clientX: number, clientY: number, additive: boolean): void {
    const left = Math.min(this.dragStart.x, clientX);
    const right = Math.max(this.dragStart.x, clientX);
    const top = Math.min(this.dragStart.y, clientY);
    const bottom = Math.max(this.dragStart.y, clientY);
    const ids: string[] = [];
    for (const [id, object] of this.previewObjects) {
      const projected = object.position.clone().project(this.activeCamera);
      const rect = this.canvas.getBoundingClientRect();
      const x = rect.left + ((projected.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - projected.y) / 2) * rect.height;
      if (x >= left && x <= right && y >= top && y <= bottom) ids.push(id);
    }
    this.select(ids, additive);
  }

  private readTransformFromSelection(): void {
    const id = this.selection.values().next().value as string | undefined;
    if (!id) return;
    const object = this.level.objects.find((entry) => entry.id === id);
    const visual = this.previewObjects.get(id);
    if (!object || !visual) {
      const spawn = this.level.spawnPoints.find((entry) => entry.id === id);
      if (spawn && visual) {
        spawn.position = {
          x: visual.position.x,
          y: visual.position.y,
          z: visual.position.z,
        };
      }
      return;
    }
    object.transform = {
      position: {
        x: visual.position.x,
        y: visual.position.y,
        z: visual.position.z,
      },
      rotation: {
        x: visual.rotation.x,
        y: visual.rotation.y,
        z: visual.rotation.z,
      },
      scale: {
        x: visual.scale.x,
        y: visual.scale.y,
        z: visual.scale.z,
      },
    };
  }

  private updateObjectBrowser(): void {
    const query = this.search.value.trim().toLowerCase();
    this.objectBrowser.replaceChildren();
    for (const type of PALETTE_TYPES) {
      const label = type === "spawn-point" ? "Spawn point" : levelObjectLabel(type);
      if (query && !label.toLowerCase().includes(query)) continue;
      const button = document.createElement("button");
      button.dataset.objectType = type;
      button.classList.toggle("active", this.placementType === type);
      const thumbnail = document.createElement("span");
      thumbnail.className = "object-thumbnail";
      const cachedThumbnail = this.thumbnailCache.get(type);
      if (cachedThumbnail) {
        const image = document.createElement("img");
        image.src = cachedThumbnail;
        image.alt = `${label} preview`;
        thumbnail.append(image);
      } else if (this.thumbnailFailed.has(type)) {
        thumbnail.classList.add("failed");
        thumbnail.textContent = "Preview unavailable";
      } else {
        thumbnail.classList.add("loading");
        this.queueThumbnail(type);
      }
      const labelElement = document.createElement("span");
      labelElement.textContent = label;
      button.append(thumbnail, labelElement);
      if (
        type === "shop" &&
        this.level.objects.some((object) => object.type === "shop")
      ) {
        button.disabled = true;
      }
      this.objectBrowser.append(button);
    }
    const levelName = this.shell.querySelector(".level-name");
    if (levelName) levelName.textContent = `${this.level.name} · ${this.level.id}`;
  }

  private queueThumbnail(type: PaletteType): void {
    if (this.thumbnailCache.has(type) || this.thumbnailInFlight.has(type)) return;
    this.thumbnailInFlight.add(type);
    this.thumbnailQueue = this.thumbnailQueue
      .then(async () => {
        try {
          this.thumbnailCache.set(type, await this.renderThumbnail(type));
        } catch {
          this.thumbnailFailed.add(type);
        } finally {
          this.thumbnailInFlight.delete(type);
          this.updateObjectBrowser();
        }
      });
  }

  private async renderThumbnail(type: PaletteType): Promise<string> {
    const thumbnailScene = new THREE.Scene();
    thumbnailScene.background = new THREE.Color(0x20242a);
    thumbnailScene.add(new THREE.HemisphereLight(0xd6e2f5, 0x332a23, 2));
    const key = new THREE.DirectionalLight(0xffd0a0, 3);
    key.position.set(3, 5, 4);
    thumbnailScene.add(key);

    const object = await this.createThumbnailObject(type);
    thumbnailScene.add(object);
    const bounds = new THREE.Box3().setFromObject(object);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1);
    object.position.sub(center);

    const camera = new THREE.PerspectiveCamera(28, 1.5, 0.01, extent * 20);
    camera.position.set(extent * 1.55, extent * 1.15, extent * 1.55);
    camera.lookAt(0, extent * 0.15, 0);
    this.thumbnailRenderer.render(thumbnailScene, camera);
    return this.thumbnailRenderer.domElement.toDataURL("image/png");
  }

  private async createThumbnailObject(type: PaletteType): Promise<THREE.Object3D> {
    const modelUrls: Partial<Record<PaletteType, string>> = {
      car: "/models/noir-pickup.glb",
      shop: "/models/noir-shop.glb",
      warehouse: "/models/noir-warehouse.glb",
      tenement: "/models/noir-tenement.glb",
      crate: "/models/crate.glb",
      tree: "/models/noir-pine.glb",
      bush: "/models/noir-shrub.glb",
      "trash-bag": "/models/noir-trash-bag.glb",
      "oil-barrel": "/models/noir-oil-barrel.glb",
      forklift: "/models/noir-forklift.glb",
      fence: "/models/noir-fence.glb",
      "fence-gate": "/models/noir-fence-gate.glb",
      "street-light": "/models/noir-lightpole.glb",
    };
    const modelUrl = modelUrls[type];
    if (modelUrl) {
      const gltf = await this.thumbnailLoader.loadAsync(modelUrl);
      return gltf.scene.clone(true);
    }

    switch (type) {
      case "wall":
        return new THREE.Mesh(
          new THREE.BoxGeometry(8, 2.5, 0.5),
          new THREE.MeshStandardMaterial({ color: 0x7d8184, roughness: 0.8 })
        );
      case "street-light": {
        const light = new THREE.Group();
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.18, 2.5, 8),
          new THREE.MeshStandardMaterial({ color: 0x555b63, metalness: 0.5 })
        );
        pole.position.y = 1.25;
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 12, 8),
          new THREE.MeshStandardMaterial({
            color: 0xffc07b,
            emissive: 0xff8d3a,
            emissiveIntensity: 2,
          })
        );
        lamp.position.set(0.45, 2.5, 0);
        light.add(pole, lamp);
        return light;
      }
      case "traffic-cone":
        return new THREE.Mesh(
          new THREE.ConeGeometry(0.25, 0.8, 16),
          new THREE.MeshStandardMaterial({ color: 0xe87531, roughness: 0.7 })
        );
      case "spawn-point":
        return new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16),
          new THREE.MeshStandardMaterial({
            color: 0x72c5d8,
            emissive: 0x164955,
            emissiveIntensity: 1.5,
          })
        );
      case "fence":
      case "fence-gate":
      case "trash-bag":
      case "oil-barrel":
      case "forklift":
      case "car":
      case "shop":
      case "warehouse":
      case "tenement":
      case "crate":
      case "tree":
      case "bush":
        return new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.8 })
        );
      default: {
        const unhandled: never = type;
        throw new Error(`Unhandled thumbnail type: ${String(unhandled)}`);
      }
    }
  }

  private selectedEntries(): SelectionEntry[] {
    const entries: SelectionEntry[] = [];
    for (const id of this.selection) {
      const object = this.level.objects.find((entry) => entry.id === id);
      if (object) entries.push({ id, type: object.type, transform: object.transform });
      const spawn = this.level.spawnPoints.find((entry) => entry.id === id);
      if (spawn) {
        entries.push({
          id,
          type: "spawn-point",
          transform: {
            position: { ...spawn.position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        });
      }
    }
    return entries;
  }

  private updateInspector(): void {
    this.selectionList.replaceChildren();
    for (const entry of this.selectedEntries()) {
      const item = document.createElement("li");
      item.className = "selected";
      item.textContent = `${entry.type} · ${entry.id}`;
      this.selectionList.append(item);
    }
    const entry = this.selectedEntries()[0];
    if (!entry) {
      this.inspector.innerHTML = "<p>No selection</p>";
      return;
    }
    const fields = (title: string, values: { axis: "x" | "y" | "z"; value: number }[]) => `
      <h3>${title}</h3>
      <div class="inspector-grid">
        ${values
          .map(
            ({ axis, value }) =>
              `<label>${axis.toUpperCase()}<input data-field="${title.toLowerCase()}-${axis}" data-axis="${axis}" type="number" step="0.1" value="${value.toFixed(2)}"></label>`
          )
          .join("")}
      </div>`;
    this.inspector.innerHTML =
      `<p>${levelObjectLabel(entry.type === "spawn-point" ? "bush" : entry.type)} · ${entry.id}</p>` +
      fields("Position", [
        { axis: "x", value: entry.transform.position.x },
        { axis: "y", value: entry.transform.position.y },
        { axis: "z", value: entry.transform.position.z },
      ]) +
      (entry.type === "spawn-point"
        ? ""
        : fields("Rotation", [
            { axis: "x", value: entry.transform.rotation.x },
            { axis: "y", value: entry.transform.rotation.y },
            { axis: "z", value: entry.transform.rotation.z },
          ]) +
          fields("Scale", [
            { axis: "x", value: entry.transform.scale.x },
            { axis: "y", value: entry.transform.scale.y },
            { axis: "z", value: entry.transform.scale.z },
          ]));
    this.inspector.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((input) => {
      input.addEventListener("change", () => {
        const id = this.selection.values().next().value as string | undefined;
        if (!id) return;
        const axis = input.dataset.axis as "x" | "y" | "z";
        const [section] = (input.dataset.field ?? "").split("-");
        const object = this.level.objects.find((candidate) => candidate.id === id);
        const spawn = this.level.spawnPoints.find((candidate) => candidate.id === id);
        if (!Number.isFinite(Number(input.value))) return;
        this.pushHistory();
        if (object && (section === "position" || section === "rotation" || section === "scale")) {
          object.transform[section][axis] = Number(input.value);
        } else if (spawn && section === "position") {
          spawn.position[axis] = Number(input.value);
        }
        this.renderLevel();
        this.updateValidation();
      });
    });
  }

  private updateValidation(): void {
    const diagnostics = validateLevel(this.level);
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    this.validation.className = `validation ${errors.length > 0 ? "invalid" : "valid"}`;
    if (diagnostics.length === 0) {
      this.validation.textContent = "Valid level. Ready to export or playtest.";
      return;
    }
    this.validation.innerHTML = `<strong>${errors.length ? `${errors.length} error(s)` : "Warnings"}</strong><ul>${diagnostics
      .slice(0, 8)
      .map((diagnostic) => `<li>${diagnostic.path}: ${diagnostic.message}</li>`)
      .join("")}</ul>`;
  }

  private pushHistory(): void {
    this.history.push(cloneLevelDocument(this.level));
    if (this.history.length > 50) this.history.shift();
    this.redoHistory.length = 0;
  }

  private undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.redoHistory.push(cloneLevelDocument(this.level));
    this.level = previous;
    this.selection.clear();
    this.renderLevel();
  }

  private redo(): void {
    const next = this.redoHistory.pop();
    if (!next) return;
    this.history.push(cloneLevelDocument(this.level));
    this.level = next;
    this.selection.clear();
    this.renderLevel();
  }

  private deleteSelection(): void {
    if (this.selection.size === 0) return;
    this.pushHistory();
    this.level.objects = this.level.objects.filter((object) => !this.selection.has(object.id));
    this.level.spawnPoints = this.level.spawnPoints.filter((spawn) => !this.selection.has(spawn.id));
    this.selection.clear();
    this.renderLevel();
  }

  private exportLevel(): void {
    try {
      const content = serializeLevelDocument(this.level);
      const blob = new Blob([content], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${this.level.id}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "Level is invalid");
    }
  }

  private playtest(): void {
    try {
      serializeLevelDocument(this.level);
      window.open(`/?level=${encodeURIComponent(this.level.id)}`, "_blank");
    } catch (error) {
      this.showError(error instanceof Error ? error.message : "Level is invalid");
    }
  }

  private showError(message: string): void {
    this.validation.className = "validation invalid";
    this.validation.textContent = message;
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    for (const helper of this.selectionHelpers.values()) helper.update();
    const primary = this.primarySelection();
    if (primary) this.updateGizmoSize(primary);
    this.renderer.render(this.scene, this.activeCamera);
  };

  public importFile(file: File): void {
    void file.text().then((source) => {
      try {
        const level = parseLevelDocument(JSON.parse(source) as unknown);
        this.pushHistory();
        this.level = cloneLevelDocument(level);
        this.selection.clear();
        this.renderLevel();
      } catch (error) {
        this.showError(error instanceof Error ? error.message : "Could not import level");
      }
    });
  }
}
