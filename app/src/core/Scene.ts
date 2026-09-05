import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Lighting-neutral albedos, warm practical keys and restrained cool sky fill.
// PBR light intensities are candela; exposure is applied once in OutputPass.
export const TONE_MAPPING = THREE.ACESFilmicToneMapping;
export const EXPOSURE = 1.4;
export const NIGHT_SKY_COLOR = 0x8492a6;
export const NIGHT_GROUND_COLOR = 0x30271c;
export const SKY_FILL_INTENSITY = .24;
export const MOON_COLOR = 0x9dabc2;
export const MOON_INTENSITY = .24;
export const MOON_DIRECTION = new THREE.Vector3(-18, 28, -12);
export const NIGHT_HORIZON_COLOR = 0x080b10;
export const FOG_DENSITY = .014;
export const LAMP_COLOR = 0xffc07b;
export const LAMP_INTENSITY = 340;
export const LAMP_ANGLE = Math.PI / 3.3;
export const LAMP_PENUMBRA = .88;
export const LAMP_DISTANCE = 22;
export const LAMP_SHADOW_MAP_SIZE = 1024;
export const HEADLIGHT_COLOR = 0xffd39a;
export const HEADLIGHT_INTENSITY = 85;
export const HEADLIGHT_ANGLE = Math.PI / 6;
export const HEADLIGHT_DISTANCE = 20;
export const BRAKE_LIGHT_COLOR = 0xff2a1a;
export const BRAKE_LIGHT_INTENSITY = .65;
export const BRAKE_LIGHT_DISTANCE = 3;
export const PICKUP_FLASH_INTENSITY = 1.2;
export const PICKUP_FLASH_DISTANCE = 4;

export class GameScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;

  constructor() {
    // Initialize the scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(NIGHT_HORIZON_COLOR);

    // Exponential fog in the same colour as the horizon so distance fades to
    // night rather than to grey.
    this.scene.fog = new THREE.FogExp2(NIGHT_HORIZON_COLOR, FOG_DENSITY);

    // Setup the camera
    this.camera = new THREE.PerspectiveCamera(
      45, // Use a narrower FOV for isometric-like view
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Setup the renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping; output colour space stays the default sRGB.
    this.renderer.toneMapping = TONE_MAPPING;
    this.renderer.toneMappingExposure = EXPOSURE;

    // A dim reflection environment gives wet metal shape even away from lamps.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, .04).texture;
    this.scene.environmentIntensity = .1;
    room.dispose();
    pmrem.dispose();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), .22, .55, 1.15
    ));
    this.composer.addPass(new OutputPass());

    // Append renderer to DOM
    const appElement = document.getElementById("app");
    if (appElement) {
      appElement.appendChild(this.renderer.domElement);
    }

    // Handle window resize
    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  public render(): void { this.composer.render(); }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  // Base rig: cold sky fill + weak moon. The street lamps (StreetLight.ts)
  // are the key lights and are placed by the map.
  public addLights(): void {
    const skyFill = new THREE.HemisphereLight(
      NIGHT_SKY_COLOR,
      NIGHT_GROUND_COLOR,
      SKY_FILL_INTENSITY
    );
    this.scene.add(skyFill);

    const moon = new THREE.DirectionalLight(MOON_COLOR, MOON_INTENSITY);
    moon.position.copy(MOON_DIRECTION);
    moon.castShadow = true;

    // Configure shadow properties
    moon.shadow.mapSize.width = 2048;
    moon.shadow.mapSize.height = 2048;
    moon.shadow.camera.near = 0.5;
    moon.shadow.camera.far = 100;
    moon.shadow.bias = -0.00015;
    moon.shadow.normalBias = .035;

    // Set the light's shadow camera bounds
    const d = 45;
    moon.shadow.camera.left = -d;
    moon.shadow.camera.right = d;
    moon.shadow.camera.top = d;
    moon.shadow.camera.bottom = -d;
    this.scene.add(moon);
  }
}
