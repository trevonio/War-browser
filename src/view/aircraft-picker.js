import * as T from 'three';

export class AircraftPreview {
  constructor(renderer, environment) {
    this.renderer = renderer;
    this.environment = environment;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x182a36);
    this.camera = new T.PerspectiveCamera(35, 1, 0.5, 160);
    this.size = new T.Vector2();
    this.scene.add(new T.HemisphereLight(0xe6f2f4, 0x536676, 2.35));
    const key = new T.DirectionalLight(0xffe8c6, 3.3);
    key.position.set(4, 9, 6);
    this.scene.add(key);
  }

  draw(assets, angle, width, height, distance = 27) {
    const renderer = this.renderer;
    const ratio = renderer.getPixelRatio();
    renderer.getSize(this.size);
    this.camera.aspect = width / height;
    this.camera.position.set(Math.sin(angle) * distance, distance * 4 / 9, Math.cos(angle) * distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    const root = assets.own.root;
    this.scene.environment = root.userData.reflectiveMaterial ? this.environment : null;
    this.scene.environmentIntensity = 1.85;
    this.scene.add(root);
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      renderer.render(this.scene, this.camera);
      return renderer.domElement.toDataURL('image/jpeg', 0.88);
    } finally {
      root.removeFromParent();
      renderer.setPixelRatio(ratio);
      renderer.setSize(this.size.x, this.size.y, false);
    }
  }
}

export function describeAircraft(spec, card) {
  const locale = (value) => value.toLocaleString('en-US');
  const burn = spec.afterburnerThrust > 0;
  const available = spec.weaponDomains.includes('ground') ? 'Cannon, air-to-ground stores and self-defense missiles' : 'Cannon and air-to-air missiles';
  const facts = [
    ['Manufacturer', spec.manufacturer],
    ['Engines', `${spec.engines.length} · ${Math.round(spec.militaryThrust / 1000)} kN dry total${burn ? ' · afterburner available' : ''}`],
    ['Empty mass', `${locale(spec.emptyMass)} kg`],
    ['Internal fuel', `${locale(spec.fuelCapacity)} kg`],
    ['Weapons', `${spec.cannon.name} · ${spec.cannon.capacity} rounds · ${available}`],
    ['Sensors', spec.radarAvailable === false ? 'Visual and targeting pod' : `${spec.radar.label} · ${spec.radar.ranges.at(-1) / 1000} km game scope`],
    ['Roll authority', `${Math.round(T.MathUtils.radToDeg(spec.rollRate))}°/s control-rate limit`],
  ];
  card.querySelector('h3').textContent = spec.name;
  card.querySelector('.aircraft-role').textContent = spec.role;
  card.querySelector('.aircraft-description').textContent = spec.description;
  const list = card.querySelector('dl');
  for (const [label, value] of facts) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    list.append(row);
  }
  if (spec.modelCredit) {
    const credit = document.createElement('p');
    credit.className = 'aircraft-description';
    const source = document.createElement('a');
    source.href = spec.modelCredit.source;
    source.textContent = 'Model by ' + spec.modelCredit.author.split(' (')[0];
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    credit.append(source, ' · ' + spec.modelCredit.license.split(' (')[0]);
    list.after(credit);
  }
}
