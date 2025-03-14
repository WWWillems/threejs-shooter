# Game Components Organization

This directory contains the core components for the 3D shooter game. The code has been organized into several focused modules to improve maintainability and separation of concerns.

## Component Structure

### Main Components

- **IsometricControls**: The main integration class that composes all other components together
- **PlayerController**: Manages player state, movement, and physics
- **InputManager**: Handles all user input (keyboard and mouse)
- **CollisionSystem**: Handles collision detection between game objects
- **CameraController**: Controls camera positioning and behavior
- **WeaponSystem**: Manages weapons, shooting, and reloading
- **DebugVisualizer**: Provides visualization tools for debugging

### Supporting Components

- **Weapon**: Defines weapon types and behavior
- **Car**: Manages car objects and their collision properties
- **Bullet**: Controls bullet physics and behavior
- **CollisionInterface**: Defines the collision detection interface

## Design Patterns Used

The refactoring employs several important design patterns:

1. **Composition over Inheritance**: Rather than using inheritance hierarchies, the system uses object composition where each component has a specific responsibility.

2. **Dependency Injection**: Components receive their dependencies through their constructors, making them more testable and loosely coupled.

3. **Interface-based Design**: Components interact through well-defined interfaces rather than concrete implementations.

4. **Single Responsibility Principle**: Each class has a single, well-defined responsibility.

## Example Usage

```typescript
// Create the main controls
const controls = new IsometricControls(camera, canvas, playerMesh);

// Add a car to the scene
controls.addCarToScene(new THREE.Vector3(10, 0, 10));

// In animation loop
function animate() {
  requestAnimationFrame(animate);
  
  // Update all systems
  controls.update();
  
  renderer.render(scene, camera);
}
```

## Migration from Old Code

If you're working with existing code that uses the original monolithic class, you should:

1. Replace imports from `FPSControls` to `IsometricControls`
2. The public API of `IsometricControls` is backward compatible with the old implementation
3. For accessing specific subsystems, use the appropriate getter methods 