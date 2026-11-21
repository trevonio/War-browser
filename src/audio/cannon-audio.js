export class CannonAudio {
  constructor(rpm) {
    this.rate = rpm / 60;
    this.firing = false;
    this.lastPulse = -Infinity;
    this.lastImpact = -Infinity;
  }

  unlock() {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        const { sampleRate } = this.context;
        const period = 1 / this.rate;
        this.buffer = this.context.createBuffer(1, Math.round(sampleRate * period * 37), sampleRate);
        const samples = this.buffer.getChannelData(0);
        let seed = 1230627;
        let rumble = 0;
        for (let i = 0; i < samples.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const noise = seed / 2147483648 - 1;
          const time = i / sampleRate;
          const pulse = time % period;
          const crack = Math.exp(-pulse * 450);
          rumble += (noise - rumble) * 0.14;
          samples[i] = Math.tanh((noise - rumble) * crack * 0.85 + rumble * 0.67
            + Math.sin(pulse * 2 * Math.PI * 125) * Math.exp(-pulse * 260) * 0.75);
        }
      }
      if (this.context.state === 'suspended') {
        this.context.resume().then(() => this.start()).catch(() => {});
      }
    } catch {
      // The simulation remains playable on devices without audio output.
    }
  }

  beginTrigger() {
    this.voicePlayed = false;
    this.unlock();
  }

  setFiring(firing) {
    if (firing === this.firing) return;
    this.firing = firing;
    if (firing) {
      this.start();
    } else if (this.source) {
      const time = this.context.currentTime;
      this.gain.gain.cancelAndHoldAtTime?.(time);
      this.gain.gain.setTargetAtTime(0, time, 0.004);
      this.source.stop(time + 0.02);
      this.source = null;
    }
  }

  start() {
    if (!this.firing || this.source || this.context?.state !== 'running' || !this.buffer) return;
    const { source, gain } = this.voice();
    source.loop = true;
    this.voicePlayed = true;
    this.gain = gain;
    this.source = source;
    const time = this.context.currentTime;
    gain.gain.setTargetAtTime(0.33, time, 0.004);
    source.start(time);
  }

  pulse() {
    if (this.voicePlayed || this.source || this.context?.state !== 'running' || !this.buffer) return;
    const time = this.context.currentTime;
    if (time - this.lastPulse < 0.04) return;
    this.lastPulse = time;
    this.voicePlayed = true;
    const { source, gain } = this.voice();
    gain.gain.value = 0.24;
    gain.gain.setTargetAtTime(0, time + 0.009, 0.003);
    source.start(time, 0, 0.02);
  }

  impact() {
    if (this.context?.state !== 'running' || !this.buffer) return;
    const time = this.context.currentTime;
    if (time - this.lastImpact < 0.12) return;
    this.lastImpact = time;
    const { source, gain } = this.voice();
    source.playbackRate.value = 0.43;
    gain.gain.value = 0.27;
    gain.gain.setTargetAtTime(0, time + 0.012, 0.023);
    source.start(time, 0, 0.037);
  }

  cue(kind) {
    if (this.context?.state !== 'running') return;
    const { frequency, end, duration } = {
      acquire: { frequency: 525, end: 755, duration: 0.15 },
      track: { frequency: 410, end: 525, duration: 0.18 },
      threat: { frequency: 890, end: 510, duration: 0.22 },
      launch: { frequency: 170, end: 100, duration: 0.25 },
      radarLaunch: { frequency: 130, end: 75, duration: 0.30 },
    }[kind];
    const time = this.context.currentTime;
    const voice = this.context.createOscillator();
    const gain = this.context.createGain();
    voice.frequency.setValueAtTime(frequency, time);
    voice.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(0.045, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    voice.connect(gain).connect(this.context.destination);
    voice.onended = () => { voice.disconnect(); gain.disconnect(); };
    voice.start(time);
    voice.stop(time + duration);
  }

  voice() {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = 0;
    source.buffer = this.buffer;
    source.connect(gain).connect(this.context.destination);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    return { source, gain };
  }

  dispose() {
    this.setFiring(false);
    this.context?.close().catch(() => {});
  }
}
