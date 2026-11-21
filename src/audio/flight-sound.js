import { MathUtils } from 'three';

export class FlightSound {
  constructor(audio) {
    this.audio = audio;
    this.nextMix = 0;
  }

  start(context) {
    this.tones = [
      this.tone(context, [0, 0.78, 0.32, 0.13, 0.24, 0.08, 0.14], 'lowpass'),
      this.tone(context, [0, 0.16, 0.22, 0.42, 0.13, 0.4, 0.28, 0.38, 0.1], 'bandpass'),
      this.tone(context, [0, 0.71, 0.54, 0.23, 0.28, 0.11, 0.14], 'lowpass'),
      this.tone(context, [0, 0.44, 0.26, 0.38, 0.17, 0.31, 0.16], 'bandpass'),
    ];
  }

  tone(context, harmonics, type) {
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.setPeriodicWave(context.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics)));
    filter.type = type;
    filter.Q.value = 0.8;
    gain.gain.value = 0;
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start();
    return { oscillator, filter, gain };
  }

  mix(index, time, frequency, cutoff, volume) {
    const { oscillator, filter, gain } = this.tones[index];
    oscillator.frequency.setTargetAtTime(frequency, time, 0.10);
    filter.frequency.setTargetAtTime(cutoff, time, 0.12);
    gain.gain.setTargetAtTime(volume, time, 0.08);
  }

  update(flight, camera, mode, missiles, playing) {
    const { context } = this.audio;
    if (context?.state !== 'running') return;
    const time = context.currentTime;
    if (time < this.nextMix) return;
    this.nextMix = time + 0.07;
    if (!this.tones) this.start(context);
    const distance = camera.position.distanceTo(flight.position);
    const near = playing ? attenuation(distance, 140) : 0;
    const inside = mode === 'hud' ? 0.56 : 1;
    const motor = flight.failure || !flight.fuel ? 0 : flight.damage.enginePower * flight.spool;
    const burner = flight.afterburner ? motor : 0;
    const pressure = MathUtils.clamp(flight.airspeed / 660, 0, 1);
    this.mix(0, time, 30 + motor * 45 + burner * 14, 170 + motor * 360, near * inside * motor * 0.105);
    this.mix(1, time, 52 + pressure * 82, 300 + pressure * 620, near * inside * pressure ** 2 * 0.055);
    this.mix(2, time, 43 + burner * 34, 260 + burner * 330, near * inside * burner * 0.08);
    let nearest = Infinity;
    let burn = 0;
    if (playing) for (const missile of missiles) {
      if (!missile.active || missile.age >= missile.config.burn) continue;
      const range = camera.position.distanceTo(missile.position);
      if (range >= nearest) continue;
      nearest = range;
      burn = MathUtils.smoothstep(missile.config.burn - missile.age, 0, 0.25);
    }
    this.mix(3, time, 76 + burn * 30, 420 + burn * 220, attenuation(nearest, 85) * burn * 0.14);
  }
}

export function attenuation(distance, reference) {
  return 1 / (1 + (distance / reference) ** 2);
}
