// Coordinates match the procedural F-16 model, with port on local +X.
export const wingStores = {
  scale: 0.93,
  wingtip: [5.35, -0.22, -2.1],
  outer: [3.3, -0.3, -2.5],
  outerDrop: 0.35,
};

const pair = (type, name, position) => [1, -1].map((side) => ({
  type, name: `${name}-${side > 0 ? 'left' : 'right'}`,
  offset: position.map((value, axis) => value * wingStores.scale * (axis === 0 ? side : 1)),
  wing: side > 0 ? 'leftWing' : 'rightWing',
}));
const short = pair('infrared', 'wingtip', wingStores.wingtip);
const long = pair('radar', 'outer', [wingStores.outer[0], wingStores.outer[1] - wingStores.outerDrop, wingStores.outer[2]]);

export const f16CombatLoadouts = {
  short: { stations: short, flare: 8, chaff: 4 },
  intercept: { stations: [...short, ...long], flare: 8, chaff: 8 },
};
