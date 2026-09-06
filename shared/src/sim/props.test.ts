import { describe, expect, it } from 'vitest';
import { aabbContains } from './aabb';
import { propBoxes, isMovementOnlyProp, isDynamicProp, type PropSpec } from './props';
import { generateMap, solidColliders, movementOnlyColliders } from './mapLayout';
import {
  LEVEL_OBJECT_TYPES,
  levelFromMap,
  mapFromLevel,
  parseLevelDocument,
  validateLevel,
} from './level';

const forklift: PropSpec = { id: 'test-forklift', type: 'forklift',
  position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 1 };

describe('yard props', () => {
  it('blocks lowered forks at floor height but leaves the space above them clear', () => {
    const boxes = propBoxes(forklift);
    expect(boxes.some((box) => aabbContains(box, { x: .45, y: .13, z: -2.5 }))).toBe(true);
    expect(boxes.some((box) => aabbContains(box, { x: .45, y: 1, z: -2.5 }))).toBe(false);
  });
  it('rotates and scales the fork offset around the model origin', () => {
    const [, forks] = propBoxes({ ...forklift, position: { x: 10, y: 0, z: 20 },
      rotation: Math.PI / 2, scale: 2 });
    expect(forks.min.x).toBeCloseTo(4.58);
    expect(forks.max.x).toBeCloseTo(7.5);
    expect(forks.min.z).toBeCloseTo(18.94);
    expect(forks.max.z).toBeCloseTo(21.06);
    expect(forks.max.y).toBeCloseTo(.6);
  });
  it('keeps bags movement-only and barrels/forklifts in server collision', () => {
    const map = generateMap();
    const solids = solidColliders(map).map((c) => c.tag.id);
    const soft = movementOnlyColliders(map).map((c) => c.id);
    for (const prop of map.props.filter(p=>!isDynamicProp(p.type) && propBoxes(p).length>0)) {
      expect(solids.includes(`${prop.id}:0`)).toBe(!isMovementOnlyProp(prop.type));
      expect(soft.includes(`${prop.id}:0`)).toBe(isMovementOnlyProp(prop.type));
    }
  });
  it('blocks walking through chain-link while leaving projectiles clear', () => {
    const map = generateMap();
    for (const prop of map.props.filter((p) => p.type === 'fence')) {
      expect(solidColliders(map).some((c) => c.tag.id.startsWith(prop.id + ':'))).toBe(false);
      const barrier = movementOnlyColliders(map).find((c) => c.id === prop.id + ':0')!;
      expect(aabbContains(barrier.box, { ...prop.position, y: 1.2 })).toBe(true);
    }
    const rotated = propBoxes({ id: 'fence-test', type: 'fence', position: { x: 4, y: 0, z: 8 },
      rotation: Math.PI / 2, scale: 2 })[0];
    expect(rotated.max.x - rotated.min.x).toBeCloseTo(.36);
    expect(rotated.max.z - rotated.min.z).toBeCloseTo(8.36);
  });
  it('round-trips authored prop transforms and rejects unsupported tilt', () => {
    const level = levelFromMap(generateMap());
    const object = level.objects.find((o) => o.type === 'forklift')!;
    object.transform.position = { x: 24, y: 0, z: 20 };
    object.transform.rotation.y = .73;
    object.transform.scale = { x: 1.3, y: 1.3, z: 1.3 };
    const map = mapFromLevel(parseLevelDocument(JSON.parse(JSON.stringify(level))));
    expect(map.props.find((p) => p.id === object.id)).toMatchObject({
      rotation: .73, scale: 1.3, position: { x: 24, y: 0, z: 20 },
    });
    object.transform.rotation.x = .2;
    expect(validateLevel(level).some((d) => d.message.includes('Y axis'))).toBe(true);
  });

  it('rejects tilt on every authored interactive prop', () => {
    const level = levelFromMap(generateMap());
    const interactiveTypes = [
      'tire-stack',
      'fire-barrel',
      'explosive-barrel',
      'smoke-zone',
      'alarm-zone',
      'warning-light',
      'cover-panel',
      'fence-gate',
    ] as const;

    for (const type of interactiveTypes) {
      const object = level.objects.find((entry) => entry.type === type);
      expect(object, `missing ${type} in generated level`).toBeDefined();
      object!.transform.rotation.x = .2;
      expect(validateLevel(level).some((diagnostic) =>
        diagnostic.path.endsWith('.transform.rotation') &&
        diagnostic.message.includes(`${type} supports rotation around the Y axis only`)
      )).toBe(true);
      object!.transform.rotation.x = 0;
    }
  });

  it('exposes every interactive prop to level authors', () => {
    const interactiveTypes = [
      'tire-stack',
      'fire-barrel',
      'warning-light',
      'explosive-barrel',
      'smoke-zone',
      'fence-gate',
      'alarm-zone',
      'cover-panel',
    ] as const;

    expect(interactiveTypes.every((type) => LEVEL_OBJECT_TYPES.includes(type))).toBe(true);
  });
});
