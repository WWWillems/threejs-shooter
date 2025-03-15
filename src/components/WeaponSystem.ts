// Update all bullets
public updateBullets(delta: number, collisionDetector?: CollisionDetector): void {
  // Update muzzle flash timer and remove if expired
  if (this.muzzleFlash && this.muzzleFlashTimer > 0) {
    this.muzzleFlashTimer -= delta;
    if (this.muzzleFlashTimer <= 0) {
      this.scene.remove(this.muzzleFlash);
      this.muzzleFlash = null;
    } else {
      // Animate the muzzle flash (pulsing/fading effect)
      const scale = 1 + Math.sin(this.muzzleFlashTimer * 100) * 0.2;
      this.muzzleFlash.scale.set(scale, scale, scale);

      if (this.muzzleFlash.material instanceof THREE.Material) {
        this.muzzleFlash.material.opacity =
          this.muzzleFlashTimer / this.muzzleFlashDuration;
      }
    }
  }

  // Log number of active bullets
  console.log(`Updating ${this.bullets.length} bullets`);

  // Update each bullet's position
  for (let i = this.bullets.length - 1; i >= 0; i--) {
    const bullet = this.bullets[i];
    
    // Move bullet forward
    bullet.position.addScaledVector(bullet.userData.direction, bullet.userData.speed * delta);
    
    // Check for collision if we have a collision detector
    if (collisionDetector) {
      console.log("Checking bullet collision:", {
        position: {
          x: bullet.position.x.toFixed(2),
          y: bullet.position.y.toFixed(2),
          z: bullet.position.z.toFixed(2)
        },
        direction: {
          x: bullet.userData.direction.x.toFixed(2),
          y: bullet.userData.direction.y.toFixed(2),
          z: bullet.userData.direction.z.toFixed(2)
        },
        speed: bullet.userData.speed,
        isRemote: bullet.userData.isRemote || false
      });
      
      if (collisionDetector.checkForBulletCollision(bullet.position)) {
        console.log("Bullet collision detected!");
        // Remove bullet on collision
        this.scene.remove(bullet);
        this.bullets.splice(i, 1);
        continue;
      }
    }

    // Remove bullet if it's too far from origin
    if (bullet.position.length() > 1000) {
      console.log("Removing bullet - too far from origin");
      this.scene.remove(bullet);
      this.bullets.splice(i, 1);
    }
  }
} 