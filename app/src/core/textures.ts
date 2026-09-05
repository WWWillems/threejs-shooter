import * as THREE from "three";

/**
 * Colour-managed texture loading.
 *
 * Since Three.js r152 a loaded texture defaults to `NoColorSpace`. A colour
 * (basecolor / albedo) JPEG or PNG is sRGB-encoded, so it must be tagged
 * `SRGBColorSpace` or the renderer treats the encoded values as linear and the
 * surface comes out light and desaturated. Data maps (normal, roughness,
 * metalness, AO, height) hold linear values and must stay `NoColorSpace`.
 * Every texture the client loads goes through one of these helpers so the
 * distinction is made at the call site, not forgotten.
 */

const loader = new THREE.TextureLoader();

export interface TextureOptions {
  /** Tile the map this many times across the UV range (enables RepeatWrapping). */
  repeat?: number | readonly [number, number];
}

function applyOptions(texture: THREE.Texture, options?: TextureOptions): void {
  if (options?.repeat === undefined) return;
  const [u, v] =
    typeof options.repeat === "number"
      ? [options.repeat, options.repeat]
      : options.repeat;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(u, v);
}

/** Load an sRGB-encoded colour map (basecolor, albedo, emissive colour). */
export function loadColorTexture(
  url: string,
  options?: TextureOptions
): THREE.Texture {
  const texture = loader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  applyOptions(texture, options);
  return texture;
}

/** Load a linear data map (normal, roughness, metalness, AO, height). */
export function loadDataTexture(
  url: string,
  options?: TextureOptions
): THREE.Texture {
  const texture = loader.load(url);
  texture.colorSpace = THREE.NoColorSpace;
  applyOptions(texture, options);
  return texture;
}

/** The PBR maps of a texture set (see "Texture set" in CONTEXT.md). */
export interface TextureSet {
  basecolor: THREE.Texture;
  roughness: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
}

/**
 * Load the maps of a generated texture set from
 * `app/public/textures/<slug>/<slug>_{basecolor,roughness,ao}.jpg` and
 * `<slug>_normal.png`, with the colour space of each map set correctly.
 */
export function loadTextureSet(
  slug: string,
  options?: TextureOptions
): TextureSet {
  const base = `/textures/${slug}/${slug}`;
  return {
    basecolor: loadColorTexture(`${base}_basecolor.jpg`, options),
    roughness: loadDataTexture(`${base}_roughness.jpg`, options),
    normal: loadDataTexture(`${base}_normal.png`, options),
    ao: loadDataTexture(`${base}_ao.jpg`, options),
  };
}
