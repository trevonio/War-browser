import * as T from 'three';

const samplesPerTrail = 96;
const styles = {
  rocket: { width: 1.05, opacity: 0.68, color: new T.Color(0xe4d9c8), lifetime: 5.3, growth: 6 },
  contrail: { width: 0.65, opacity: 0.32, color: new T.Color(0xd6ebf3), lifetime: 4.5, growth: 6 },
  vapor: { width: 0.45, opacity: 0.26, color: new T.Color(0xe5f0f7), lifetime: 0.52, growth: 2.5 },
};

export class FlightTrails {
  constructor(scene, missiles, aircraft) {
    this.missiles = missiles.map((missile) => ({ missile, serial: -1, trail: this.createTrail('rocket') }));
    this.aircraft = aircraft.map((flight) => ({
      flight, wings: [-1, 1].map(() => this.createTrail('contrail')),
      vapor: [-1, 1].map(() => this.createTrail('vapor')),
    }));
    this.trails = [
      ...this.missiles.map((source) => source.trail),
      ...this.aircraft.flatMap((source) => [...source.wings, ...source.vapor]),
    ];
    const vertices = this.trails.length * samplesPerTrail * 6;
    this.geometry = new T.BufferGeometry();
    this.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('paint', new T.BufferAttribute(new Float32Array(vertices * 4), 4).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('edge', new T.BufferAttribute(new Float32Array(vertices), 1).setUsage(T.DynamicDrawUsage));
    this.mesh = new T.Mesh(this.geometry, new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false,
      vertexShader: `
        attribute vec4 paint;
        attribute float edge;
        varying vec4 pigment;
        varying float across;
        void main() {
          pigment = paint;
          across = edge;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec4 pigment;
        varying float across;
        void main() {
          gl_FragColor = vec4(pigment.rgb, pigment.a * (1.0 - smoothstep(0.1, 1.0, abs(across))));
          #include <colorspace_fragment>
        }
      `,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.point = new T.Vector3();
    this.start = new T.Vector3();
    this.end = new T.Vector3();
    this.axis = new T.Vector3();
    this.side = new T.Vector3();
    this.eye = new T.Vector3();
    this.setPreset({ trailDetail: 1 });
    this.clear();
  }

  createTrail(style) {
    return {
      style: styles[style], cursor: 0, count: 0, sequence: 0, emitting: false,
      samples: Array.from({ length: samplesPerTrail }, () => ({ position: new T.Vector3(), time: 0, sequence: 0 })),
    };
  }

  setPreset(preset) {
    this.detail = preset.trailDetail;
    this.interval = this.detail < 0.7 ? 0.10 : 0.06;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.mesh.material.dispose();
  }

  clear() {
    for (const trail of this.trails) {
      trail.count = trail.cursor = 0;
      trail.emitting = false;
    }
    this.nextSample = 0;
    this.mesh.visible = false;
  }

  sample(trail, position, time, active) {
    if (!active) {
      trail.emitting = false;
      return;
    }
    if (!trail.emitting) {
      trail.sequence++;
      trail.emitting = true;
    }
    const sample = trail.samples[trail.cursor];
    sample.position.copy(position);
    sample.time = time;
    sample.sequence = trail.sequence;
    trail.cursor = (trail.cursor + 1) % samplesPerTrail;
    trail.count = Math.min(samplesPerTrail, trail.count + 1);
  }

  step(time, secondaryActive) {
    if (time < this.nextSample) return;
    this.nextSample = time + this.interval;
    for (const source of this.missiles) {
      const { missile, trail } = source;
      if (source.serial !== missile.serial) trail.emitting = false;
      source.serial = missile.serial;
      this.sample(trail, missile.position, time, missile.active && missile.age < missile.config.burn);
    }
    for (const [index, source] of this.aircraft.entries()) {
      const { flight, wings, vapor } = source;
      const airborne = (index === 0 || secondaryActive[index - 1]) && !flight.grounded && !flight.failure;
      const contrail = airborne && flight.position.y >= 4300 && flight.spool > 0.32;
      const vaporizing = airborne && this.detail >= 0.85 && flight.g > 5.5 && flight.alpha > 0.12 && flight.position.y < 4300;
      for (const [side, sign] of [1, -1].entries()) {
        if (contrail) this.point.set(sign * (flight.spec.opticalSpan ?? 9.8) * 0.4745, -0.17, -2.15).applyQuaternion(flight.orientation).add(flight.position);
        this.sample(wings[side], this.point, time, contrail);
        if (vaporizing) this.point.set(sign * 2.35, 0.13, -0.65).applyQuaternion(flight.orientation).add(flight.position);
        this.sample(vapor[side], this.point, time, vaporizing);
      }
    }
  }

  render(time, camera) {
    let count = 0;
    for (const trail of this.trails) {
      if (trail.count < 2) continue;
      const { samples, style } = trail;
      const lifetime = style.lifetime * this.detail;
      let earliest = (trail.cursor - trail.count + samplesPerTrail) % samplesPerTrail;
      while (trail.count && time - samples[earliest].time >= lifetime) {
        trail.count--;
        earliest = (earliest + 1) % samplesPerTrail;
      }
      if (trail.count < 2) continue;
      let previous = null;
      let skipped = 0;
      for (let index = 0; index < trail.count; index++) {
        const sample = samples[(earliest + index) % samplesPerTrail];
        const age = time - sample.time;
        if (age >= lifetime) continue;
        const distance = sample.position.distanceTo(camera.position);
        if (!previous || sample.sequence !== previous.sequence) {
          previous = sample;
          skipped = 0;
          continue;
        }
        const stride = distance > 3200 ? 4 : distance > 900 ? 2 : 1;
        if (++skipped < stride && index < trail.count - 1) continue;
        const oldAge = time - previous.time;
        this.start.copy(previous.position);
        this.end.copy(sample.position);
        this.start.y += oldAge * 0.72;
        this.end.y += age * 0.72;
        this.axis.subVectors(this.end, this.start);
        this.eye.subVectors(camera.position, this.end);
        this.side.crossVectors(this.axis, this.eye).normalize();
        const farFade = 1 - T.MathUtils.smoothstep(distance, 4300, 9800);
        const alpha = style.opacity * farFade;
        const width = style.width + Math.min(0.9, distance * 0.001);
        const oldWidth = width + oldAge * style.growth;
        const newWidth = width + age * style.growth;
        const oldOpacity = alpha * (1 - oldAge / lifetime) ** 2;
        const newOpacity = alpha * (1 - age / lifetime) ** 2;
        count = this.vertex(count, this.start, -oldWidth, style.color, oldOpacity);
        count = this.vertex(count, this.start, oldWidth, style.color, oldOpacity);
        count = this.vertex(count, this.end, newWidth, style.color, newOpacity);
        count = this.vertex(count, this.start, -oldWidth, style.color, oldOpacity);
        count = this.vertex(count, this.end, newWidth, style.color, newOpacity);
        count = this.vertex(count, this.end, -newWidth, style.color, newOpacity);
        previous = sample;
        skipped = 0;
      }
    }
    this.mesh.visible = count > 0;
    if (!count) return;
    this.geometry.setDrawRange(0, count);
    for (const attribute of Object.values(this.geometry.attributes)) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  vertex(index, point, width, color, opacity) {
    const { position, paint, edge } = this.geometry.attributes;
    position.setXYZ(index, point.x + this.side.x * width, point.y + this.side.y * width, point.z + this.side.z * width);
    paint.setXYZW(index, color.r, color.g, color.b, opacity);
    edge.setX(index, Math.sign(width));
    return index + 1;
  }
}
