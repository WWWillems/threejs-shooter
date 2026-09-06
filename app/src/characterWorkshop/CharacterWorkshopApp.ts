import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { attachModel } from "../core/models";
import { CharacterAnimator, type CharacterMotion } from "../components/CharacterAnimator";
import { WeaponSystem } from "../components/Weapon";
import { WEAPON_IDS, WEAPONS, type WeaponId } from "@threejs-shooter/shared";
import { sfx } from "../audio/sfx";

const POSES = ["Idle", "Walk", "Run", "Crouch", "Crouch walk", "Jump", "Death"] as const;
type Pose = (typeof POSES)[number];

const getWeaponAmmoType = (id: WeaponId): string => {
  const stats = WEAPONS[id];
  return "ammoType" in stats && typeof stats.ammoType === "string" ? stats.ammoType : "Ammo";
};

const WEAPON_OPTIONS: readonly {
  id: WeaponId;
  name: string;
  ammoType: string;
}[] = WEAPON_IDS.map((id) => ({
  id,
  name: WEAPONS[id].name,
  ammoType: getWeaponAmmoType(id),
}));

const JUMP_DURATION = 0.75;

/** Drives the standalone rig/weapon preview (`character.html`), styled to match the level editor shell. */
export class CharacterWorkshopApp {
  private readonly shell: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly player: THREE.Mesh;
  private readonly weapons: WeaponSystem;
  private readonly poseList: HTMLDivElement;
  private readonly weaponList: HTMLDivElement;
  private readonly statusFields: Record<string, HTMLElement>;
  private animator: CharacterAnimator | undefined;
  private pose: Pose = "Idle";
  private jumpAge = 0;
  private shotAge = 10;
  private previousTime = performance.now();

  constructor(container: HTMLElement) {
    this.shell = document.createElement("div");
    this.shell.className = "workshop-shell";
    this.shell.innerHTML = `
      <div class="workshop-viewport">
        <span class="viewport-hint">Blender rig · skeletal animation · live game weapon effects</span>
      </div>
      <header class="workshop-topbar">
        <div class="topbar-brand">
          <span class="brand-glyph">◆</span>
          <span class="brand-title">Animation Workshop</span>
          <span class="brand-subtitle">noir-character.glb</span>
        </div>
        <div class="toolbar-divider"></div>
        <div class="toolbar-group" role="group" aria-label="Weapon actions">
          <button data-action="shoot" title="Fire (Space)"><kbd>Space</kbd>Shoot</button>
          <button data-action="reload" title="Reload (R)"><kbd>R</kbd>Reload</button>
        </div>
        <div class="topbar-spacer"></div>
        <span class="status-pill" id="status-pill">Loading rig…</span>
        <div class="toolbar-divider"></div>
        <button class="primary" data-action="reset" title="Reset pose (Esc)"><kbd>Esc</kbd>⟲ Reset</button>
      </header>
      <aside class="workshop-panel panel-animations">
        <div class="panel-header"><span>Animations</span></div>
        <div class="panel-body">
          <div class="pose-list"></div>
        </div>
      </aside>
      <aside class="workshop-panel panel-inspector">
        <div class="panel-section">
          <div class="panel-header panel-header-with-meta">
            <span>Weapons</span>
            <span class="panel-count">${WEAPON_OPTIONS.length} available</span>
          </div>
          <div class="weapon-list" role="listbox" aria-label="Available weapons"></div>
        </div>
        <div class="panel-section panel-section-grow">
          <div class="panel-header"><span>Status</span></div>
          <ul class="status-list">
            <li><span>State</span><strong data-field="state">Idle</strong></li>
            <li><span>Weapon</span><strong data-field="weapon">Pistol</strong></li>
            <li><span>Ammo</span><strong data-field="ammo">0 / 0</strong></li>
            <li><span>Reloading</span><strong data-field="reloading">No</strong></li>
            <li><span>Firing</span><strong data-field="firing">No</strong></li>
          </ul>
        </div>
        <div class="panel-section">
          <div class="panel-header"><span>Rig</span></div>
          <p class="rig-note">Drag to orbit, scroll to zoom in on the tailoring and weapon details.</p>
        </div>
      </aside>
      <footer class="workshop-statusbar">
        <span class="workshop-hint">
          Click a pose or press 1–7 · Space fires · R reloads · Drag to orbit · Scroll to zoom
        </span>
      </footer>
    `;
    container.replaceChildren(this.shell);
    this.viewport = this.shell.querySelector(".workshop-viewport") as HTMLDivElement;
    this.poseList = this.shell.querySelector(".pose-list") as HTMLDivElement;
    this.weaponList = this.shell.querySelector(".weapon-list") as HTMLDivElement;
    this.statusFields = {
      pill: this.shell.querySelector("#status-pill") as HTMLElement,
      state: this.shell.querySelector('[data-field="state"]') as HTMLElement,
      weapon: this.shell.querySelector('[data-field="weapon"]') as HTMLElement,
      ammo: this.shell.querySelector('[data-field="ammo"]') as HTMLElement,
      reloading: this.shell.querySelector('[data-field="reloading"]') as HTMLElement,
      firing: this.shell.querySelector('[data-field="firing"]') as HTMLElement,
    };

    this.scene.background = new THREE.Color(0x171e25);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.setSize(this.viewport.clientWidth, this.viewport.clientHeight);
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute("aria-label", "Character workshop viewport");
    this.viewport.prepend(this.canvas);

    const aspect = this.viewport.clientWidth / this.viewport.clientHeight;
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.05, 100);
    this.camera.position.set(3.2, 2.4, -4.4);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xb9c9df, 0x383128, 2));
    const key = new THREE.DirectionalLight(0xffd6a3, 4);
    key.position.set(-3, 5, -4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9abfea, 2);
    rim.position.set(2, 3, 3);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x30383d, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.player = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.player.position.y = 1;
    this.scene.add(this.player);
    sfx.setListener(this.camera, this.player);
    this.weapons = new WeaponSystem(this.scene, this.player, null);
    for (const id of WEAPON_IDS.slice(3)) this.weapons.grantWeapon(id, 100, false);
    const teamPicker=document.createElement('select');teamPicker.setAttribute('aria-label','Character team');
    teamPicker.innerHTML='<option value="a">Team A · Trench coat</option><option value="b">Team B · Street enforcer</option>';
    this.viewport.append(teamPicker);teamPicker.style.cssText='position:absolute;top:48px;left:16px;z-index:5;padding:8px;background:#20262d;color:#eee;border:1px solid #68717c';
    let generation=0;
    const loadTeam=(team:string)=>{
      const request=++generation;
      attachModel(this.player,`noir-character-team-${team}`,model=>{
        if(request!==generation){this.player.remove(model);return;}
        if(this.animator){this.player.remove(this.animator.model);this.animator.dispose();}
        model.position.y=-1;this.animator=new CharacterAnimator(model,model.animations);
      });
    };
    teamPicker.addEventListener('change',()=>loadTeam(teamPicker.value));loadTeam('a');

    this.buildPoseList();
    this.buildWeaponList();
    this.bindActions();
    this.bindKeyboard();
    window.addEventListener("resize", this.handleResize);

    this.setPose("Idle");
    this.animate();
  }

  private buildPoseList(): void {
    POSES.forEach((pose, index) => {
      const button = document.createElement("button");
      button.dataset.pose = pose;
      button.innerHTML = `<span>${pose}</span><kbd>${index + 1}</kbd>`;
      button.addEventListener("click", () => this.setPose(pose));
      this.poseList.append(button);
    });
  }

  private buildWeaponList(): void {
    WEAPON_OPTIONS.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "weapon-option";
      button.dataset.weaponIndex = String(index);
      button.dataset.weaponName = option.name;
      button.setAttribute("role", "option");
      button.setAttribute("aria-label", `${option.name}, ${option.ammoType}`);
      button.setAttribute("aria-selected", String(index === 0));
      button.title = `Select ${option.name} (${index + 1})`;
      button.innerHTML = `
        <span class="weapon-option-key" aria-hidden="true">${index + 1}</span>
        <span class="weapon-option-copy">
          <span class="weapon-option-name"></span>
          <span class="weapon-option-ammo"></span>
        </span>
        <span class="weapon-option-check" aria-hidden="true">◆</span>
      `;
      button.querySelector(".weapon-option-name")!.textContent = option.name;
      button.querySelector(".weapon-option-ammo")!.textContent = option.ammoType;
      button.classList.toggle("active", index === 0);
      button.addEventListener("click", () => {
        this.weapons.switchToWeapon(index);
        this.weaponList.querySelectorAll<HTMLButtonElement>("button").forEach((entry) => {
          entry.classList.toggle("active", entry === button);
          entry.setAttribute("aria-selected", String(entry === button));
        });
        this.updateStatus();
      });
      this.weaponList.append(button);
    });
  }

  private bindActions(): void {
    this.shell.addEventListener("pointerdown", () => sfx.unlock(), { passive: true });
    this.shell.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const actionButton = target.closest<HTMLButtonElement>("button[data-action]");
      if (!actionButton) return;
      this.handleAction(actionButton.dataset.action);
    });
  }

  private handleAction(action: string | undefined): void {
    switch (action) {
      case "shoot":
        this.shoot();
        break;
      case "reload":
        this.weapons.reload();
        break;
      case "reset":
        this.setPose("Idle");
        this.animator?.reset();
        break;
      default:
        break;
    }
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (event) => {
      sfx.unlock();
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < POSES.length) {
        this.setPose(POSES[index]);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        this.shoot();
      } else if (event.key.toLowerCase() === "r") {
        this.weapons.reload();
      } else if (event.key === "Escape") {
        this.setPose("Idle");
        this.animator?.reset();
      }
    });
  }

  private shoot(): void {
    if (this.pose === "Death") return;
    this.weapons.shoot(this.scene);
    this.animator?.shoot(1);
    this.shotAge = 0;
  }

  private setPose(pose: Pose): void {
    if (this.pose === "Death") this.animator?.reset();
    this.pose = pose;
    this.jumpAge = 0;
    this.weapons.setDead(pose === "Death");
    this.poseList.querySelectorAll<HTMLButtonElement>("button[data-pose]").forEach((button) => {
      button.classList.toggle("active", button.dataset.pose === pose);
    });
  }

  private handleResize = (): void => {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private updateStatus(): void {
    const ammo = this.weapons.getAmmoInfo();
    const state = this.animator?.state ?? "Loading rig…";
    this.statusFields.state.textContent = state;
    this.statusFields.weapon.textContent = ammo.isEmpty
      ? "None"
      : this.weaponList.querySelector<HTMLButtonElement>("button.active")?.dataset.weaponName ?? "—";
    this.statusFields.ammo.textContent = `${ammo.current} / ${ammo.total}`;
    this.statusFields.reloading.textContent = ammo.isReloading ? "Yes" : "No";
    this.statusFields.firing.textContent = this.shotAge < 0.15 ? "Yes" : "No";
    const pillParts = [state, `${ammo.current}/${ammo.total}`];
    if (ammo.isReloading) pillParts.push("reloading");
    if (this.shotAge < 0.15) pillParts.push("firing");
    this.statusFields.pill.textContent = pillParts.join(" · ");
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min((now - this.previousTime) / 1000, 0.05);
    this.previousTime = now;
    this.jumpAge += dt;
    this.shotAge += dt;

    const crouched = this.pose.startsWith("Crouch");
    const jumping = this.pose === "Jump" && this.jumpAge < JUMP_DURATION;
    this.player.position.y = 1 + (jumping ? Math.sin((this.jumpAge / JUMP_DURATION) * Math.PI) * 0.65 : 0);

    const motion: CharacterMotion = {
      speed: this.pose === "Run" ? 10 : this.pose === "Walk" ? 6 : this.pose === "Crouch walk" ? 3.5 : 0,
      forward: 1,
      strafe: 0,
      verticalSpeed: this.jumpAge < JUMP_DURATION / 2 ? 3 : -3,
      grounded: !jumping,
      crouched,
      dead: this.pose === "Death",
      reload: this.weapons.getReloadFraction(),
    };
    this.animator?.update(dt, motion);
    this.weapons.updatePresentation(dt, crouched);
    this.weapons.updateBullets(dt);
    if (this.weapons.checkReloadProgress(now)) this.weapons.completeReload();

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateStatus();
  };
}
