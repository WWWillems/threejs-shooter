/**
 * @deprecated This file is deprecated. Please use IsometricControls instead.
 *
 * FPSControls has been replaced by a more modular architecture in IsometricControls.
 * This file now re-exports IsometricControls for backward compatibility.
 *
 * To migrate:
 * 1. Update your imports from: import { IsometricControls } from "./FPSControls";
 *                         to: import { IsometricControls } from "./IsometricControls";
 * 2. All functionality remains the same - no code changes needed beyond imports.
 *
 * This file will be removed in a future release.
 */

// Re-export everything from IsometricControls for backward compatibility
export * from "./IsometricControls";
