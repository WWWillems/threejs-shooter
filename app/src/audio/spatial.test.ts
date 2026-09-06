import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { attenuationGain, screenPan } from "./spatial";

describe("attenuationGain", () => {
  it("is full within the reference distance", () => {
    expect(attenuationGain(0)).toBe(1);
    expect(attenuationGain(4)).toBe(1);
    expect(attenuationGain(2, 4, 40)).toBe(1);
  });

  it("is silent at and beyond the max distance", () => {
    expect(attenuationGain(40)).toBe(0);
    expect(attenuationGain(1000)).toBe(0);
    expect(attenuationGain(10, 4, 10)).toBe(0);
  });

  it("falls off monotonically between ref and max", () => {
    let previous = attenuationGain(4);
    for (let d = 5; d <= 40; d++) {
      const gain = attenuationGain(d);
      expect(gain).toBeLessThan(previous);
      expect(gain).toBeGreaterThanOrEqual(0);
      expect(gain).toBeLessThanOrEqual(1);
      previous = gain;
    }
  });

  it("is continuous at both boundaries", () => {
    expect(attenuationGain(4.0001)).toBeCloseTo(1, 3);
    expect(attenuationGain(39.9999)).toBeCloseTo(0, 3);
  });

  it("honours custom ref and max", () => {
    expect(attenuationGain(5, 5, 6)).toBe(1);
    expect(attenuationGain(5.5, 5, 6)).toBeCloseTo(0.25);
    expect(attenuationGain(6, 5, 6)).toBe(0);
  });
});

describe("screenPan", () => {
  /** Camera above and behind the origin, looking down at it like the game does. */
  const makeCamera = (): THREE.PerspectiveCamera => {
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  };

  it("is centred for a point on the camera axis", () => {
    const camera = makeCamera();
    expect(screenPan(new THREE.Vector3(0, 0, 0), camera)).toBeCloseTo(0);
    expect(screenPan(new THREE.Vector3(0, 2, 2), camera)).toBeCloseTo(0);
  });

  it("pans left for points on the left and right for points on the right", () => {
    const camera = makeCamera();
    const left = screenPan(new THREE.Vector3(-4, 0, 0), camera);
    const right = screenPan(new THREE.Vector3(4, 0, 0), camera);
    expect(left).toBeLessThan(0);
    expect(right).toBeGreaterThan(0);
    expect(left).toBeCloseTo(-right);
  });

  it("pans further for points further from the axis", () => {
    const camera = makeCamera();
    const near = screenPan(new THREE.Vector3(1, 0, 0), camera);
    const far = screenPan(new THREE.Vector3(3, 0, 0), camera);
    expect(far).toBeGreaterThan(near);
  });

  it("clamps the magnitude for off-screen points", () => {
    const camera = makeCamera();
    expect(screenPan(new THREE.Vector3(1000, 0, 0), camera)).toBe(0.7);
    expect(screenPan(new THREE.Vector3(-1000, 0, 0), camera)).toBe(-0.7);
  });

  it("is centred for points behind the camera", () => {
    const camera = makeCamera();
    expect(screenPan(new THREE.Vector3(30, 20, 20), camera)).toBe(0);
  });
});
