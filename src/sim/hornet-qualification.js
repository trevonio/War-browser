import { resolveLoadout } from './loadouts.js';

export const hornetQualification = 'hornetQualification';
const airWindow = 190;
const airStores = ['infrared', 'radar'];
const freeFall = ['bomb', 'rocket'];
const precision = ['laser', 'gps', 'optical'];

export function qualificationAssignment(spec, saved) {
  if (saved) {
    const { stations, errors } = resolveLoadout(spec, saved);
    const pod = stations.some(({ type }) => type === 'pod');
    const strikeRounds = stations.reduce((sum, { type, quantity }) =>
      sum + (freeFall.includes(type) || pod && precision.includes(type) ? quantity : 0), 0);
    if (!errors.length && strikeRounds >= 2 && stations.some(({ type }) => airStores.includes(type))) return saved;
  }
  return spec.loadoutPresets.Multirole;
}

export function qualificationAirStatus(combat) {
  if (combat.player.flight.failure) return { reason: combat.player.flight.failure };
  if (combat.enemiesDown) {
    return combat.cannonHits || combat.missileHits
      ? { cleared: true }
      : { reason: 'The intercept target was lost before you scored a hit.' };
  }
  if (combat.player.flight.elapsed >= airWindow) return { reason: 'The intercept window expired.' };
  return null;
}
