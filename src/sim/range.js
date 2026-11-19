export const runway = { start: -3200, end: 400, halfWidth: 33, elevation: 24 };

const airStart = { x: -1170, y: 900, z: -5950, speed: 192, pitch: 0.052, throttle: 0.52, runway: false };

export const scenarios = {
  air: airStart,
  practice: { ...airStart },
  dogfight: { ...airStart, x: -4150, y: 1450, z: -6250 },
  runway: { x: 0, y: runway.elevation + 1.28, z: runway.start + 170, speed: 0, pitch: 0, throttle: 0.12, runway: true },
};

export const hangars = [-2180, -2100, -2020].map((z) => ({ x: 351, z }));

const { sin, cos, abs, max, min, exp, floor } = Math;

function smooth(low, high, value) {
  const t = max(0, min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

// Includes the furthest possible shoreline and its underwater transition.
export const landMinimumX = -3760;

export function shoreAt(z) {
  return -1950 + 690 * sin((z + 1150) / 2400) + 390 * sin(z / 970) - 430 * cos(z / 6100);
}

function noise(x, z) {
  const ix = floor(x);
  const iz = floor(z);
  const fx = smooth(0, 1, x - ix);
  const fz = smooth(0, 1, z - iz);
  const hash = (a, b) => {
    const value = sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - floor(value);
  };
  const a = hash(ix, iz);
  const b = hash(ix, iz + 1);
  return a + (hash(ix + 1, iz) - a) * fx +
    (b + (hash(ix + 1, iz + 1) - b) * fx - a - (hash(ix + 1, iz) - a) * fx) * fz;
}

export function terrainHeight(x, z) {
  const coast = x - shoreAt(z);
  if (coast < -300) return -35;
  const hills = smooth(400, 3900, coast);
  const crest = 1 - abs(2 * noise(x / 2110 + 2, z / 2310 - 4) - 1);
  const ridge = exp(-(((x - 6600 - 2050 * sin(z / 4900)) / 5800) ** 2));
  const long = noise(x / 4350 - 11, z / 5100 + 13);
  const fine = noise(x / 760, z / 890);
  const detail = noise(x / 210 + 16, z / 270);
  const height = -22 + 52 * smooth(-300, 450, coast) +
    hills * (90 + long * 520 + ridge * (160 + 1120 * crest ** 2) + 180 * fine + 34 * detail);
  const airfield = max(abs(x - 32) / 390, abs(z + 1400) / 2070);
  const flatten = 1 - smooth(0.95, 1.40, airfield);
  return height + (runway.elevation - height) * flatten;
}

export const range = {
  surfaceAt: terrainHeight,
  maxTerrainHeight: 2140,
  structures: hangars.map(({ x, z }) => ({
    shape: 'box', surface: 'ground',
    min: [x - 24, runway.elevation, z - 21],
    max: [x + 24, runway.elevation + 14, z + 21],
  })),
  heightAt(x, z) {
    return max(0, terrainHeight(x, z));
  },
  isRunway(x, z) {
    return abs(x) <= runway.halfWidth && z >= runway.start && z <= runway.end;
  },
};
