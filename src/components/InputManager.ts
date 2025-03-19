import * as THREE from "three";

// Mouse event type extension
interface MouseEvent {
  mozMovementX?: number;
  mozMovementY?: number;
  clientX: number;
  clientY: number;
  button: number;
}

// Input manager events
type InputCallback = () => void;

/**
 * Manages all user input (keyboard and mouse) for the game
 */
export class InputManager {
  // Mouse state
  private mousePosition = new THREE.Vector2();
  private mouseDown = false;

  // Keyboard state
  private keys: { [key: string]: boolean } = {};

  // Event callbacks
  private onShootCallbacks: InputCallback[] = [];
  private onReloadCallbacks: InputCallback[] = [];
  private onWeaponSwitchCallbacks: ((index: number) => void)[] = [];
  private onMouseMoveCallbacks: ((mousePos: THREE.Vector2) => void)[] = [];
  private onShowLeaderboardCallbacks: InputCallback[] = [];
  private onHideLeaderboardCallbacks: InputCallback[] = [];
  private onMouseDownCallbacks: InputCallback[] = [];
  private onMouseUpCallbacks: InputCallback[] = [];

  // Input state
  private keyboardEnabled = true;
  private mouseEnabled = true;

  constructor(private domElement: HTMLCanvasElement) {
    this.initControls();
  }

  /**
   * Disable keyboard input
   */
  public disableKeyboardInput(): void {
    this.keyboardEnabled = false;
    // Clear all currently pressed keys
    this.keys = {};
  }

  /**
   * Enable keyboard input
   */
  public enableKeyboardInput(): void {
    this.keyboardEnabled = true;
  }

  /**
   * Disable mouse input
   */
  public disableMouseInput(): void {
    this.mouseEnabled = false;
  }

  /**
   * Enable mouse input
   */
  public enableMouseInput(): void {
    this.mouseEnabled = true;
  }

  /**
   * Initialize all event listeners
   */
  private initControls(): void {
    // Prevent context menu on right-click
    this.domElement.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    // Mouse move event
    this.domElement.addEventListener("mousemove", (event: Event) => {
      if (!this.mouseEnabled) return;

      const mouseEvent = event as unknown as MouseEvent;
      // Calculate mouse position in normalized device coordinates (-1 to +1)
      this.mousePosition.x = (mouseEvent.clientX / window.innerWidth) * 2 - 1;
      this.mousePosition.y = -(mouseEvent.clientY / window.innerHeight) * 2 + 1;

      // Notify listeners
      for (const callback of this.onMouseMoveCallbacks) {
        callback(this.mousePosition);
      }
    });

    // Key down events
    document.addEventListener("keydown", (event) => {
      if (!this.keyboardEnabled) return;

      this.keys[event.code] = true;

      // Handle special key events
      switch (event.code) {
        case "KeyR":
          for (const callback of this.onReloadCallbacks) {
            callback();
          }
          break;
        case "Digit1":
          for (const callback of this.onWeaponSwitchCallbacks) {
            callback(0);
          }
          break;
        case "Digit2":
          for (const callback of this.onWeaponSwitchCallbacks) {
            callback(1);
          }
          break;
        case "Digit3":
          for (const callback of this.onWeaponSwitchCallbacks) {
            callback(2);
          }
          break;
        case "KeyQ":
          for (const callback of this.onWeaponSwitchCallbacks) {
            callback(-1); // Previous
          }
          break;
        case "KeyE":
          for (const callback of this.onWeaponSwitchCallbacks) {
            callback(-2); // Next
          }
          break;
        case "Tab":
          event.preventDefault(); // Prevent tab from changing focus
          for (const callback of this.onShowLeaderboardCallbacks) {
            callback();
          }
          break;
      }
    });

    // Key up events
    document.addEventListener("keyup", (event) => {
      if (!this.keyboardEnabled) return;

      this.keys[event.code] = false;

      // Handle special key up events
      if (event.code === "Tab") {
        for (const callback of this.onHideLeaderboardCallbacks) {
          callback();
        }
      }
    });

    // Mouse click event for shooting
    this.domElement.addEventListener("mousedown", (event: Event) => {
      if (!this.mouseEnabled) return;

      const mouseEvent = event as unknown as MouseEvent;
      if (mouseEvent.button === 0) {
        // Left mouse button
        this.mouseDown = true;
        for (const callback of this.onShootCallbacks) {
          callback();
        }
        for (const callback of this.onMouseDownCallbacks) {
          callback();
        }
      }
    });

    // Mouse up event
    this.domElement.addEventListener("mouseup", (event: Event) => {
      if (!this.mouseEnabled) return;

      const mouseEvent = event as unknown as MouseEvent;
      if (mouseEvent.button === 0) {
        // Left mouse button
        this.mouseDown = false;
        for (const callback of this.onMouseUpCallbacks) {
          callback();
        }
      }
    });

    // Also handle mouse leaving the window
    document.addEventListener("mouseout", () => {
      if (this.mouseDown) {
        this.mouseDown = false;
        for (const callback of this.onMouseUpCallbacks) {
          callback();
        }
      }
    });
  }

  /**
   * Check if a key is currently pressed
   */
  public isKeyPressed(code: string): boolean {
    return this.keys[code] === true;
  }

  /**
   * Get the current mouse position
   */
  public getMousePosition(): THREE.Vector2 {
    return this.mousePosition.clone();
  }

  /**
   * Register callback for shoot event
   */
  public onShoot(callback: InputCallback): void {
    this.onShootCallbacks.push(callback);
  }

  /**
   * Register callback for reload event
   */
  public onReload(callback: InputCallback): void {
    this.onReloadCallbacks.push(callback);
  }

  /**
   * Register callback for weapon switch event
   */
  public onWeaponSwitch(callback: (index: number) => void): void {
    this.onWeaponSwitchCallbacks.push(callback);
  }

  /**
   * Register callback for mouse move event
   */
  public onMouseMove(callback: (mousePos: THREE.Vector2) => void): void {
    this.onMouseMoveCallbacks.push(callback);
  }

  /**
   * Register callback for showing leaderboard
   */
  public onShowLeaderboard(callback: InputCallback): void {
    this.onShowLeaderboardCallbacks.push(callback);
  }

  /**
   * Register callback for hiding leaderboard
   */
  public onHideLeaderboard(callback: InputCallback): void {
    this.onHideLeaderboardCallbacks.push(callback);
  }

  /**
   * Register callback for mouse down event
   */
  public onMouseDown(callback: InputCallback): void {
    this.onMouseDownCallbacks.push(callback);
  }

  /**
   * Register callback for mouse up event
   */
  public onMouseUp(callback: InputCallback): void {
    this.onMouseUpCallbacks.push(callback);
  }

  /**
   * Check if mouse is currently down
   */
  public isMouseDown(): boolean {
    return this.mouseDown;
  }
}
