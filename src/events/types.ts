export interface BaseEvent {
  timestamp: number;
}

export interface PlayerPositionEvent extends BaseEvent {
  position: {
    x: number;
    y: number;
    z: number;
  };
  rotation: number;
}

export interface WeaponEvent extends BaseEvent {
  weaponType: string;
  action: "shoot" | "reload" | "switch" | "pickup" | "drop";
  data?: {
    ammo?: number;
    totalAmmo?: number;
    position?: {
      x: number;
      y: number;
      z: number;
    };
    direction?: {
      x: number;
      y: number;
      z: number;
    };
  };
}

export interface CombatEvent extends BaseEvent {
  type: "hit" | "damage" | "kill";
  sourceId: string;
  targetId: string;
  damage?: number;
  weaponType?: string;
  position?: {
    x: number;
    y: number;
    z: number;
  };
}

// Add more event interfaces as needed
