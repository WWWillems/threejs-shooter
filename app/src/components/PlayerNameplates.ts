import * as THREE from "three";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { TEAMS, type Team } from "@threejs-shooter/shared";
import { PLAYER_DIMENSIONS } from "./PlayerCollider";

/** How far above a player's own centre (`PlayerCollider`'s box origin) the nameplate floats. */
const NAMEPLATE_HEIGHT_OFFSET = PLAYER_DIMENSIONS.height / 2 + 0.35;

interface Nameplate {
  object: CSS2DObject;
  container: HTMLElement;
  nameElement: HTMLElement;
  healthFillElement: HTMLElement;
  name: string;
  team: Team | null;
  teammate: boolean;
}

/**
 * Floating name + health bar above every *other* player, rendered with
 * `CSS2DRenderer` (styled HTML projected to screen space) rather than a
 * canvas-texture sprite: nameplates are plain, easily-themed `div`s, and this
 * game's per-room player count is small enough that the DOM overhead is
 * negligible. The nameplate carries the player's team colour and marks
 * teammates, since the character model itself is the same for both sides.
 */
export class PlayerNameplates {
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly nameplates = new Map<string, Nameplate>();

  constructor(private readonly scene: THREE.Scene) {
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    const domElement = this.labelRenderer.domElement;
    domElement.style.position = "absolute";
    domElement.style.top = "0";
    domElement.style.left = "0";
    domElement.style.pointerEvents = "none";
    domElement.style.zIndex = "50";

    const appElement = document.getElementById("app");
    (appElement ?? document.body).appendChild(domElement);

    window.addEventListener("resize", this.onWindowResize);
  }

  private readonly onWindowResize = (): void => {
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
  };

  /** Create a nameplate above `mesh` and parent it, so it follows automatically. */
  public add(playerId: string, mesh: THREE.Object3D, name: string): void {
    if (this.nameplates.has(playerId)) return;

    const container = document.createElement("div");
    container.className = "player-nameplate";

    const nameElement = document.createElement("div");
    nameElement.className = "player-nameplate-name";
    nameElement.textContent = name;
    container.append(nameElement);

    const healthTrack = document.createElement("div");
    healthTrack.className = "player-nameplate-health-track";
    const healthFillElement = document.createElement("div");
    healthFillElement.className = "player-nameplate-health-fill";
    healthTrack.append(healthFillElement);
    container.append(healthTrack);

    const object = new CSS2DObject(container);
    object.position.set(0, NAMEPLATE_HEIGHT_OFFSET, 0);
    object.center.set(0.5, 1);
    mesh.add(object);

    this.nameplates.set(playerId, {
      object,
      container,
      nameElement,
      healthFillElement,
      name,
      team: null,
      teammate: false,
    });
  }

  /** Colour the nameplate by team and tag it when the player is on our side. */
  public setTeam(playerId: string, team: Team, teammate: boolean): void {
    const nameplate = this.nameplates.get(playerId);
    if (!nameplate || (nameplate.team === team && nameplate.teammate === teammate)) return;
    nameplate.team = team;
    nameplate.teammate = teammate;
    for (const t of TEAMS) nameplate.container.classList.toggle(`team-${t}`, t === team);
    nameplate.container.classList.toggle("is-teammate", teammate);
  }

  /** Update the displayed name, if it changed (e.g. arrived after `add`). */
  public setName(playerId: string, name: string): void {
    const nameplate = this.nameplates.get(playerId);
    if (!nameplate || nameplate.name === name) return;
    nameplate.name = name;
    nameplate.nameElement.textContent = name;
  }

  /** Update the health bar fill, `hp` out of `maxHp`. */
  public setHealth(playerId: string, hp: number, maxHp: number): void {
    const nameplate = this.nameplates.get(playerId);
    if (!nameplate) return;
    const percent = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
    nameplate.healthFillElement.style.width = `${percent}%`;
  }

  /** Hide the nameplate, e.g. while the player is dead. */
  public setVisible(playerId: string, visible: boolean): void {
    const nameplate = this.nameplates.get(playerId);
    if (!nameplate) return;
    nameplate.object.visible = visible;
  }

  public remove(playerId: string): void {
    const nameplate = this.nameplates.get(playerId);
    if (!nameplate) return;
    nameplate.object.removeFromParent();
    this.nameplates.delete(playerId);
  }

  /** Call once per frame after players are positioned, before/after the main render. */
  public render(camera: THREE.Camera): void {
    this.labelRenderer.render(this.scene, camera);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.onWindowResize);
    for (const playerId of [...this.nameplates.keys()]) this.remove(playerId);
    this.labelRenderer.domElement.remove();
  }
}
