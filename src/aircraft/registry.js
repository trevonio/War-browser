import { f16 } from './f16.js';
import { f15 } from './f15.js';
import { a10 } from './a10.js';

export const aircraftRegistry = {
  [f16.id]: {
    spec: f16,
    loadModel: async () => {
      const { createF16Visual, createOpponentVisual } = await import('./f16-visual.js');
      return { create: createF16Visual, clone: createOpponentVisual };
    },
  },
  [a10.id]: {
    spec: a10,
    loadModel: async () => (await import('./a10-visual.js')).loadA10Visual(),
  },
  [f15.id]: {
    spec: f15,
    loadModel: async () => {
      const { createF15Visual, cloneF15Visual } = await import('./f15-visual.js');
      return { create: createF15Visual, clone: cloneF15Visual };
    },
  },
};
export const defaultAircraft = f16.id;
