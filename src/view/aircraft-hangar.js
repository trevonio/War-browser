import * as T from 'three';
import { aircraftRegistry } from '../aircraft/registry.js';
import { disposeObjects } from './resources.js';

export class AircraftHangar {
  constructor() {
    this.cache = new Map();
  }

  load(id) {
    if (!this.cache.has(id)) {
      const definition = aircraftRegistry[id];
      const promise = definition.loadModel().then((adapter) => {
        const own = adapter.create();
        const enemy = adapter.clone(own, true);
        return { adapter, own, enemy, distant: adapter.hasLOD ? null : silhouette(definition.spec) };
      }).catch((error) => {
        this.cache.delete(id);
        throw error;
      });
      this.cache.set(id, promise);
    }
    return this.cache.get(id);
  }

  instantiate(assets, hostile = false) {
    const aircraft = assets.adapter.clone(hostile ? assets.enemy : assets.own, false);
    if (hostile) {
      if (!assets.distant) {
        aircraft.hasLOD = true;
        return aircraft;
      }
      const low = assets.distant.clone();
      aircraft.root.add(low);
      low.visible = false;
      aircraft.setDistant = (value) => {
        low.visible = value;
        aircraft.airframe.visible = !value;
      };
    }
    return aircraft;
  }

  async dispose() {
    const results = await Promise.allSettled(this.cache.values());
    this.cache.clear();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { own, enemy, distant } = result.value;
        disposeObjects(...[own.root, enemy.root, distant].filter(Boolean));
      }
    }
  }
}

function silhouette(spec) {
  const twin = spec.engines.length === 2;
  const scale = twin ? 1.22 : 1;
  const positions = [];
  const polygon = (points) => {
    for (let index = 1; index < points.length - 1; index++) positions.push(...points[0], ...points[index], ...points[index + 1]);
  };
  polygon([[0, 0.35, 7.0], [0.86, 0.2, 2], [0.92, 0, -6.6], [-0.92, 0, -6.6], [-0.86, 0.2, 2]]);
  polygon([[0, 0, 2.2], [5.3, 0, -1.6], [5.1, 0, -2.65], [0, 0, -3.25], [-5.1, 0, -2.65], [-5.3, 0, -1.6]]);
  polygon([[0, 0, -4.8], [2.5, 0, -6.4], [2.45, 0, -7.2], [0, 0, -7.0], [-2.45, 0, -7.2], [-2.5, 0, -6.4]]);
  for (const x of twin ? [-1.32, 1.32] : [0]) {
    polygon([[x, 0.1, -3.9], [x, 2.55, -5.7], [x, 2.39, -6.55], [x, 0.1, -6.82]]);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions.map((value) => value * scale), 3));
  return new T.Mesh(geometry, new T.MeshBasicMaterial({ color: 0xb29179, side: T.DoubleSide }));
}
