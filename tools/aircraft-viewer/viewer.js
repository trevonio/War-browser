import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { controlLabels, loadAircraftModel } from './aircraft-model.js';

const byId = (id) => document.getElementById(id);
const status = byId('view-status');
const number = Intl.NumberFormat();
const phases = { orbit: [1.05, .67, 1.25], top: [0, 1, -.001], port: [1, .015, 0], underside: [0, -1, -.001] };
const defaultDir = new URL(import.meta.env.BASE_URL + 'fa-18-hornet/', document.baseURI);

try {
  start();
} catch (error) {
  status.textContent = `Could not start the WebGL 2 viewer. ${error.message}`;
}

function start() {
  const container = byId('canvas');
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;
  renderer.domElement.setAttribute('aria-label', 'Interactive aircraft rendering');
  container.append(renderer.domElement);

  const scene = new T.Scene();
  const environment = new RoomEnvironment();
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, .08).texture;
  scene.environmentIntensity = 1.05;
  environment.dispose();
  pmrem.dispose();
  const camera = new T.PerspectiveCamera(42, 1, .1, 1800);
  const cameraControls = new OrbitControls(camera, renderer.domElement);
  cameraControls.enableDamping = true;
  cameraControls.enablePan = false;
  cameraControls.minDistance = 5;
  cameraControls.maxDistance = 960;
  cameraControls.target.set(0, 0, .25);
  camera.position.set(16, 11, 20);
  cameraControls.update();
  scene.add(new T.HemisphereLight(0xe3f3ff, 0x9c9b99, 2.55));
  for (const [color, intensity, position] of [
    [0xfff1dc, 3.15, [3, 10, 6]], [0xb3e1ff, 2.1, [-5, 2, -4]], [0x98a9c1, .9, [0, -5, 2]],
  ]) {
    const light = new T.DirectionalLight(color, intensity);
    light.position.set(...position);
    scene.add(light);
  }
  const grid = new T.GridHelper(50, 24, 0x5c7981, 0x3d525e);
  grid.material.transparent = true;
  grid.material.opacity = .3;
  grid.position.y = -1.9;
  scene.add(grid);

  let model, loadId = 0, lodMode = 'auto', gear = 0, gearTarget = 0;
  let fitDistance = 24, activeView = 'orbit', previous, lastStats = 0;
  const values = {};
  const samples = [];
  const gearButton = byId('gear');
  const toggleAppearance = () => {
    if (model) {
      model.overlays.visible = byId('anchors').checked;
      model.wireframe(byId('wireframe').checked);
    }
    byId('anchor-info').hidden = !byId('anchors').checked;
  };

  function setCamera(view) {
    activeView = view;
    const direction = new T.Vector3().fromArray(phases[view]).normalize();
    const distance = camera.aspect < 1 ? fitDistance / Math.max(camera.aspect, .5) : fitDistance;
    camera.position.copy(cameraControls.target).addScaledVector(direction, distance);
    cameraControls.update();
    for (const button of document.querySelectorAll('[data-view]')) {
      button.setAttribute('aria-pressed', button.dataset.view === view);
    }
    grid.visible = view !== 'underside';
  }

  function frameModel(next) {
    const size = next.bounds.getSize(new T.Vector3());
    next.bounds.getCenter(cameraControls.target);
    cameraControls.target.y *= .55;
    fitDistance = Math.max(size.x, size.y, size.z) * 1.35;
    cameraControls.minDistance = fitDistance * .18;
    cameraControls.maxDistance = Math.max(fitDistance * 25, next.manifest.levels[2].distance * 1.25);
    camera.far = cameraControls.maxDistance * 2;
    camera.updateProjectionMatrix();
    grid.position.y = next.bounds.min.y - .19;
    setCamera('orbit');
  }

  function setGear(next) {
    gearTarget = next;
    gearButton.textContent = next ? 'Deploy landing gear' : 'Retract landing gear';
    gearButton.setAttribute('aria-pressed', Boolean(next));
  }

  function resetRig() {
    for (const input of byId('controls').querySelectorAll('input')) {
      input.value = 0;
      input.dispatchEvent(new Event('input'));
    }
    setGear(0);
  }

  function createControls(next) {
    const controls = byId('controls');
    controls.replaceChildren();
    for (const [control, label] of Object.entries(controlLabels)) {
      if (!next.controls.has(control)) continue;
      const row = document.createElement('label');
      row.className = 'control';
      row.append(document.createTextNode(label));
      const input = document.createElement('input');
      input.type = 'range';
      input.dataset.control = control;
      input.min = ['flaps', 'leadingEdge'].includes(control) ? 0 : -100;
      input.max = 100;
      const output = document.createElement('output');
      input.addEventListener('input', () => {
        values[control] = Number(input.value) / 100;
        output.value = `${input.value}%`;
      });
      row.append(input, output);
      controls.append(row);
    }
    gearButton.disabled = !next.controls.has('gear');
    gearButton.hidden = gearButton.disabled;
    resetRig();
  }

  function link(text, url) {
    const a = document.createElement('a');
    a.textContent = text;
    const target = new URL(url, document.baseURI);
    if (['https:', 'http:', 'blob:'].includes(target.protocol)) a.href = target.href;
    return a;
  }

  function describe(next, fileUrl) {
    const { manifest } = next;
    const { title, author, source, license } = manifest.attribution;
    byId('model-title').textContent = manifest.title;
    const credit = byId('attribution');
    credit.replaceChildren();
    const [, authorName, authorUrl] = /^(.*) \((https?:[^)]+)\)$/.exec(author) ?? [];
    credit.append(link(title, source), document.createTextNode(' by '),
      authorUrl ? link(authorName, authorUrl) : document.createTextNode(author),
      document.createTextNode(` · ${license.split(' (')[0]}`));
    credit.title = license;
    const files = byId('model-files');
    files.replaceChildren();
    if (fileUrl) {
      for (const [index, level] of manifest.levels.entries()) {
        const item = link(`Download LOD ${index}`, fileUrl(level.file));
        item.download = `${manifest.id}-lod${index}.glb`;
        files.append(item);
      }
      const manifestLink = link('Manifest', fileUrl('manifest.json'));
      manifestLink.download = 'manifest.json';
      files.append(manifestLink, link('Import report', fileUrl('report.json')));
    }
    const info = byId('anchor-info');
    const points = {};
    for (const { kind } of manifest.attachments) points[kind] = (points[kind] ?? 0) + 1;
    info.textContent = Object.entries(points).map(([kind, count]) =>
      `${count} ${kind}${count === 1 ? '' : 's'}`).join(' · ');
  }

  async function show(manifest, url, fileUrl) {
    const id = ++loadId;
    status.textContent = 'Loading aircraft…';
    try {
      const next = await loadAircraftModel(manifest, url);
      if (id !== loadId) { next.dispose(); return; }
      model?.dispose();
      model = next;
      gear = gearTarget = 0;
      scene.add(next.lod, next.overlays);
      frameModel(next);
      createControls(next);
      describe(next, fileUrl);
      toggleAppearance();
      status.textContent = '';
    } catch (error) {
      if (id === loadId) status.textContent = error.message;
    }
  }

  async function loadDefault() {
    try {
      const fileUrl = (name) => new URL(name, defaultDir).href;
      const response = await fetch(fileUrl('manifest.json'));
      if (!response.ok) throw new Error('Could not fetch the default aircraft manifest.');
      await show(await response.json(), fileUrl, fileUrl);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  byId('package-files').addEventListener('change', async (event) => {
    const files = new Map([...event.target.files].map((file) => [file.name, file]));
    event.target.value = '';
    const urls = new Map();
    try {
      if (!files.has('manifest.json')) throw new Error('Select manifest.json and the three LOD GLBs together.');
      const manifest = JSON.parse(await files.get('manifest.json').text());
      for (const level of manifest.levels ?? []) {
        const file = files.get(level.file);
        if (!file) throw new Error(`Select ${level.file} with the manifest.`);
        urls.set(level.file, URL.createObjectURL(file));
      }
      await show(manifest, (name) => urls.get(name));
    } catch (error) {
      status.textContent = error.message;
    } finally {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    }
  });

  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => setCamera(button.dataset.view));
  }
  for (const button of document.querySelectorAll('[data-lod]')) {
    button.addEventListener('click', () => {
      lodMode = button.dataset.lod === 'auto' ? 'auto' : Number(button.dataset.lod);
      for (const peer of document.querySelectorAll('[data-lod]')) peer.setAttribute('aria-pressed', peer === button);
    });
  }
  for (const [id, factor] of [['zoom-in', .68], ['zoom-out', 1.48]]) {
    byId(id).addEventListener('click', () => {
      const offset = camera.position.clone().sub(cameraControls.target);
      const distance = T.MathUtils.clamp(offset.length() * factor, cameraControls.minDistance, cameraControls.maxDistance);
      camera.position.copy(cameraControls.target).add(offset.setLength(distance));
      cameraControls.update();
    });
  }
  byId('reset').addEventListener('click', resetRig);
  byId('anchors').addEventListener('change', toggleAppearance);
  byId('wireframe').addEventListener('change', toggleAppearance);
  gearButton.addEventListener('click', () => setGear(1 - gearTarget));
  new ResizeObserver(() => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight, false);
  }).observe(container);

  renderer.setAnimationLoop((now) => {
    const elapsed = previous === undefined ? 0 : now - previous;
    previous = now;
    cameraControls.update();
    camera.updateMatrixWorld();
    grid.visible = activeView !== 'underside' && camera.position.y > grid.position.y;
    const active = model?.select(camera, lodMode);
    if (model) {
      gear += Math.sign(gearTarget - gear) * Math.min(Math.abs(gearTarget - gear), elapsed / 1750);
      model.pose(values, gear);
    }
    const start = performance.now();
    renderer.render(scene, camera);
    samples.push(performance.now() - start);
    if (now - lastStats >= 500) {
      const fps = 1000 * samples.length / (now - lastStats);
      samples.sort((a, b) => a - b);
      const { triangles, calls } = renderer.info.render;
      byId('triangle-count').textContent = number.format(triangles);
      byId('draw-count').textContent = number.format(calls);
      byId('fps').textContent = number.format(Math.round(fps));
      byId('render-time').textContent = `${samples[Math.floor(samples.length / 2)].toFixed(1)} ms CPU`;
      if (model) {
        const meters = camera.position.distanceTo(cameraControls.target);
        byId('level-summary').textContent = `LOD ${active} · ${Math.round(meters)} m`;
        container.dataset.lod = active;
        container.dataset.gear = gear.toFixed(3);
      }
      lastStats = now;
      samples.length = 0;
    }
  });
  loadDefault();
}
