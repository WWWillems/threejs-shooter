import * as THREE from "three";

export class Ground {
  private ground: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    // Load concrete texture for the ground
    const textureLoader = new THREE.TextureLoader();
    const concreteBaseColor = textureLoader.load(
      "/textures/concrete/concrete_diffuse.jpg"
    );
    const concreteNormalMap = textureLoader.load(
      "/textures/concrete/concrete_normal.jpg"
    );
    const concreteRoughnessMap = textureLoader.load(
      "/textures/concrete/concrete_roughness.jpg"
    );

    // Set texture repeat for a realistic scale
    const textureRepeat = 15; // Reduced from 30 to see more texture detail
    concreteBaseColor.wrapS = concreteBaseColor.wrapT = THREE.RepeatWrapping;
    concreteBaseColor.repeat.set(textureRepeat, textureRepeat);
    concreteNormalMap.wrapS = concreteNormalMap.wrapT = THREE.RepeatWrapping;
    concreteNormalMap.repeat.set(textureRepeat, textureRepeat);
    concreteRoughnessMap.wrapS = concreteRoughnessMap.wrapT =
      THREE.RepeatWrapping;
    concreteRoughnessMap.repeat.set(textureRepeat, textureRepeat);

    // Create ground material
    const groundMaterial = new THREE.MeshStandardMaterial({
      map: concreteBaseColor,
      normalMap: concreteNormalMap,
      roughnessMap: concreteRoughnessMap,
      color: 0x666666, // Darker gray for a more concrete-like appearance
      roughness: 1.0, // Increased roughness for a more matte finish
      metalness: 0.05, // Slight metalness to add subtle variation
      normalScale: new THREE.Vector2(1.0, 1.0), // Increased normal map intensity for more visible texture
      displacementScale: 0.2, // Subtle displacement for more surface detail
    });

    // Add noise to the concrete material for more realism
    const noiseTexture = new THREE.DataTexture(
      this.generateNoiseTexture(64, 64),
      64,
      64,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
    noiseTexture.repeat.set(5, 5);
    noiseTexture.needsUpdate = true;

    // Use the noise texture to influence material properties
    groundMaterial.onBeforeCompile = (shader) => {
      // Add noise uniform
      shader.uniforms.noiseTexture = { value: noiseTexture };

      // Add to shader header
      shader.fragmentShader = `
        uniform sampler2D noiseTexture;
        ${shader.fragmentShader}`;

      // Modify the final color to add noise variation
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <output_fragment>",
        `
        // Add subtle noise variation to color
        vec4 noise = texture2D(noiseTexture, vUv * 5.0);
        vec3 finalColor = outgoingLight * (0.95 + noise.r * 0.1);
        
        gl_FragColor = vec4(finalColor, diffuseColor.a);
        `
      );
    };

    // Create ground geometry and mesh
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    this.ground.position.y = 0;
    this.ground.receiveShadow = true;

    // Add to scene
    scene.add(this.ground);
  }

  // Function to generate noise texture data
  private generateNoiseTexture(width: number, height: number): Float32Array {
    const size = width * height * 4; // RGBA
    const data = new Float32Array(size);

    for (let i = 0; i < size; i += 4) {
      const value = Math.random() * 0.1 + 0.95; // Subtle noise (0.95-1.05)
      data[i] = value; // R
      data[i + 1] = value; // G
      data[i + 2] = value; // B
      data[i + 3] = 1.0; // A
    }

    return data;
  }
}
