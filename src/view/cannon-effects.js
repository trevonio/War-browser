import * as T from 'three';

const styles = {
  smoke: { color: 0xb7b4ac, life: 0.40, size: 0.44, speed: 3, opacity: 0.27, lift: 1 },
  ground: { color: 0xc4ad83, life: 0.52, size: 0.60, speed: 6, opacity: 0.45, lift: 3 },
  water: { color: 0xc3e4ef, life: 0.37, size: 0.44, speed: 12, opacity: 0.78, lift: 8 },
  metal: { color: 0xffbc59, life: 0.26, size: 0.28, speed: 23, opacity: 0.92, lift: 2 },
  destroyed: { color: 0xfca350, life: 0.72, size: 0.85, speed: 17, opacity: 0.72, lift: 4 },
  fire: { color: 0xff8c33, life: 0.34, size: 0.98, speed: 10, opacity: 0.85, lift: 4 },
  engineSmoke: { color: 0x343539, life: 1.7, size: 1.8, speed: 6, opacity: 0.62, lift: 5 },
  fuelMist: { color: 0xc6d9d5, life: 0.90, size: 0.53, speed: 4, opacity: 0.45, lift: -2 },
  rocketTrail: { color: 0xd4d4cf, life: 1.85, size: 1.35, speed: 4, opacity: 0.47, lift: 2 },
  rocketFlash: { color: 0xffcb75, life: 0.34, size: 2.6, speed: 22, opacity: 0.9, lift: 5 },
  explosion: { color: 0xffa54d, life: 0.65, size: 4.2, speed: 35, opacity: 0.72, lift: 5 },
  debris: { color: 0x9d7864, life: 1.0, size: 0.85, speed: 45, opacity: 0.85, lift: -6 },
};
for (const style of Object.values(styles)) style.rgb = new T.Color(style.color);

function dynamicAttribute(array, size) {
  return new T.BufferAttribute(array, size).setUsage(T.DynamicDrawUsage);
}

export class CannonEffects {
  constructor(scene, guns, practice) {
    this.practice = practice;
    const flashMaterial = new T.SpriteMaterial({
      color: 0xffc879, map: flashTexture(), blending: T.AdditiveBlending,
      transparent: true, depthWrite: false, toneMapped: false,
    });
    this.guns = guns.map(({ muzzle, ballistics }) => {
      const flash = new T.Sprite(flashMaterial);
      flash.position.z = 0.24;
      flash.visible = false;
      muzzle.add(flash);
      return { flash, ballistics, lastShot: -Infinity };
    });

    const vertices = new Float32Array(this.guns.reduce((length, gun) => length + gun.ballistics.rounds.length, 0) * 6);
    const colors = new Float32Array(vertices.length);
    for (let i = 0; i < colors.length; i += 6) colors.set([0.22, 0.06, 0.01, 1, 0.56, 0.20], i);
    this.tracerGeometry = new T.BufferGeometry();
    this.tracerGeometry.setAttribute('position', dynamicAttribute(vertices, 3));
    this.tracerGeometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    this.tracers = new T.LineSegments(this.tracerGeometry, new T.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.88, depthWrite: false,
      blending: T.AdditiveBlending, toneMapped: false,
    }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);

    this.particles = Array.from({ length: 192 }, () => ({
      position: new T.Vector3(), velocity: new T.Vector3(), age: 0, life: 0, style: styles.smoke,
    }));
    this.particleGeometry = new T.BufferGeometry();
    this.particleGeometry.setAttribute('position', dynamicAttribute(new Float32Array(192 * 3), 3));
    this.particleGeometry.setAttribute('appearance', dynamicAttribute(new Float32Array(192 * 4), 4));
    this.particleGeometry.setAttribute('size', dynamicAttribute(new Float32Array(192), 1));
    this.points = new T.Points(this.particleGeometry, new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { pixelScale: { value: 400 } },
      vertexShader: `
        attribute vec4 appearance;
        attribute float size;
        uniform float pixelScale;
        varying vec4 paint;
        void main() {
          vec4 vertex = modelViewMatrix * vec4(position, 1.0);
          paint = appearance;
          gl_Position = projectionMatrix * vertex;
          gl_PointSize = clamp(size * pixelScale / max(1.0, -vertex.z), 1.5, 48.0);
        }
      `,
      fragmentShader: `
        varying vec4 paint;
        void main() {
          float radius = length(gl_PointCoord - vec2(0.5));
          float alpha = 1.0 - smoothstep(0.10, 0.5, radius);
          gl_FragColor = vec4(paint.rgb, paint.a * alpha);
          #include <colorspace_fragment>
        }
      `,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.drones = makeDrones(scene, practice.targets);
    this.damageOrigin = new T.Vector3();
    this.budget = 112;
    this.seed = 32491;
    this.clear();
  }

  clear() {
    for (const gun of this.guns) gun.lastShot = -Infinity;
    this.lastImpact = -Infinity;
    this.particleCount = 0;
    this.fullCursor = 0;
  }

  setPreset(preset) {
    this.budget = preset.effectParticles;
    this.particleCount = Math.min(this.particleCount, this.budget);
    this.fullCursor = 0;
  }

  resize(renderer, camera) {
    this.points.material.uniforms.pixelScale.value = renderer.domElement.height * camera.projectionMatrix.elements[5] * 0.5;
  }

  shot(gun, position, direction, time, count) {
    this.guns[gun].lastShot = time;
    if (count % 8 === 1) this.emit('smoke', position, 1, direction);
  }

  impact(kind, position, time, destroyed) {
    if (destroyed) {
      this.emit('destroyed', position, this.budget > 100 ? 18 : 9);
      return;
    }
    if (time - this.lastImpact < 0.035) return;
    this.lastImpact = time;
    this.emit(kind, position, this.budget > 100 ? 5 : 3);
  }

  damageTrail(flight) {
    const emitters = flight.spec.damageEmitters;
    const { damage } = flight;
    if (!emitters || flight.failure) return;
    if (damage.fire || (damage.enginePower > 0 && damage.enginePower < 0.63)) {
      this.damageOrigin.fromArray(emitters.engine).applyQuaternion(flight.orientation).add(flight.position);
      this.emit('engineSmoke', this.damageOrigin, 2);
      if (damage.fire) this.emit('fire', this.damageOrigin, 2);
    }
    if (damage.leak > 0 && flight.fuel > 0) {
      this.damageOrigin.fromArray(emitters.fuel).applyQuaternion(flight.orientation).add(flight.position);
      this.emit('fuelMist', this.damageOrigin, 1);
    }
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  emit(kind, position, amount, direction = null) {
    const style = styles[kind];
    for (let n = 0; n < amount; n++) {
      const index = this.particleCount < this.budget ? this.particleCount++ : this.fullCursor++ % this.budget;
      const particle = this.particles[index];
      particle.position.copy(position);
      particle.velocity.set((this.random() - 0.5) * style.speed, this.random() * style.lift,
        (this.random() - 0.5) * style.speed);
      if (direction) particle.velocity.addScaledVector(direction, style.speed);
      particle.age = 0;
      particle.life = style.life * (0.55 + this.random() * 0.65);
      particle.style = style;
    }
  }

  render(time, dt, blend, active) {
    const tracerPosition = this.tracerGeometry.attributes.position;
    let vertices = 0;
    for (const { flash, ballistics, lastShot } of this.guns) {
      const flashAge = time - lastShot;
      flash.visible = active && flashAge < 0.023;
      if (flash.visible) {
        const size = 0.60 - Math.max(0, flashAge) * 14;
        flash.scale.set(size, size, 1);
      }
      for (let i = 0; i < ballistics.count; i++) {
        const round = ballistics.rounds[i];
        if (!round.tracer) continue;
        const x = T.MathUtils.lerp(round.previous.x, round.position.x, blend);
        const y = T.MathUtils.lerp(round.previous.y, round.position.y, blend);
        const z = T.MathUtils.lerp(round.previous.z, round.position.z, blend);
        const tail = Math.min(0.009, round.travel / Math.max(1, round.velocity.length()) * 0.8);
        tracerPosition.setXYZ(vertices++, x - round.velocity.x * tail, y - round.velocity.y * tail, z - round.velocity.z * tail);
        tracerPosition.setXYZ(vertices++, x, y, z);
      }
    }
    this.tracers.visible = vertices > 0;
    this.tracerGeometry.setDrawRange(0, vertices);
    if (vertices) tracerPosition.needsUpdate = true;

    const attributes = this.particleGeometry.attributes;
    for (let i = 0; i < this.particleCount;) {
      const particle = this.particles[i];
      particle.age += dt;
      if (particle.age >= particle.life) {
        this.particles[i] = this.particles[--this.particleCount];
        this.particles[this.particleCount] = particle;
        continue;
      }
      particle.position.addScaledVector(particle.velocity, dt);
      const fraction = particle.age / particle.life;
      const { rgb, size, opacity } = particle.style;
      attributes.position.setXYZ(i, particle.position.x, particle.position.y, particle.position.z);
      attributes.appearance.setXYZW(i, rgb.r, rgb.g, rgb.b, opacity * (1 - fraction));
      attributes.size.setX(i, size * (1 + fraction * 2.9));
      i++;
    }
    this.points.visible = this.particleCount > 0;
    this.particleGeometry.setDrawRange(0, this.particleCount);
    if (this.particleCount) {
      attributes.position.needsUpdate = true;
      attributes.appearance.needsUpdate = true;
      attributes.size.needsUpdate = true;
    }

    for (let i = 0; i < this.drones.length; i++) {
      const target = this.practice.targets[i];
      const drone = this.drones[i];
      drone.visible = target.active;
      if (drone.visible) {
        drone.position.copy(target.previous).lerp(target.position, blend);
        if (target.crossing) {
          drone.rotation.y = Math.atan2(target.position.x - target.previous.x, target.position.z - target.previous.z);
        }
      }
    }
  }
}

function flashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const bloom = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  bloom.addColorStop(0, 'rgba(255,255,246,1)');
  bloom.addColorStop(0.25, 'rgba(255,219,160,0.92)');
  bloom.addColorStop(0.60, 'rgba(255,132,54,0.48)');
  bloom.addColorStop(1, 'rgba(255,140,80,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function makeDrones(scene, targets) {
  const hullShape = new T.CapsuleGeometry(0.91, 4.9, 2, 8).rotateX(Math.PI / 2);
  const wingShape = new T.BoxGeometry(11, 0.24, 2.3);
  const tailShape = new T.BoxGeometry(4, 0.22, 0.90);
  const ringShape = new T.TorusGeometry(6.8, 0.13, 4, 20);
  const hullMaterial = new T.MeshStandardMaterial({ color: 0xf5a446, roughness: 0.7 });
  const wingMaterial = new T.MeshStandardMaterial({ color: 0xdde3d9, roughness: 0.76 });
  const ringMaterial = new T.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.78 });
  return targets.map((target) => {
    const drone = new T.Group();
    const hull = new T.Mesh(hullShape, hullMaterial);
    const wing = new T.Mesh(wingShape, wingMaterial);
    const tail = new T.Mesh(tailShape, wingMaterial);
    tail.position.set(0, 0.52, -2.7);
    const ring = new T.Mesh(ringShape, ringMaterial);
    drone.add(hull, wing, tail, ring);
    drone.scale.setScalar(target.radius / 7.5);
    drone.visible = false;
    scene.add(drone);
    return drone;
  });
}
