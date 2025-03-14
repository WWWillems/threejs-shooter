/// <reference types="vite/client" />

// Define a type for impact animation functions
type ImpactAnimationFn = (delta: number) => void;

// Extend the Window interface
interface Window {
  __impactAnimations: ImpactAnimationFn[];
}
