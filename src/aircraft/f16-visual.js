import * as T from 'three';
import { cannonMount } from '../sim/cannon.js';
import { f16 } from './f16.js';
import { wingStores } from './f16-ordnance.js';
import { bindF16Rig, buildF16Rig } from './f16-rig.js';

// Geometry and materials adapted from the supplied procedural F-16 viewer.
// One modeling unit is approximately a meter after the original 0.93 scale.
export function createF16Visual() {
  const root = new T.Group();
  const P = new T.Group();
  P.name = 'F-16C airframe';
  P.scale.setScalar(wingStores.scale);
  root.add(P);
  // Textura de chapa: paneles, remaches y suciedad
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = '#8c9298';
    x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 7000; i++) {
      x.fillStyle =
        Math.random() < 0.5
          ? `rgba(255,255,255,${Math.random() * 0.06})`
          : `rgba(0,0,0,${Math.random() * 0.07})`;
      x.fillRect(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 40, 1 + Math.random() * 3);
    }
    x.strokeStyle = 'rgba(25,28,32,.6)';
    x.lineWidth = 1.4;
    for (let i = 0; i < 24; i++) {
      const p = Math.random() * 1024;
      x.beginPath();
      x.moveTo(p, 0);
      x.lineTo(p, 1024);
      x.moveTo(0, p);
      x.lineTo(1024, p);
      x.stroke();
    }
    x.fillStyle = 'rgba(20,20,20,.45)';
    for (let i = 0; i < 1500; i++) x.fillRect(Math.random() * 1024, Math.random() * 1024, 1.6, 1.6);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const sk = (rep, col = 0xffffff) => {
    const t = mk();
    t.repeat.set(rep, rep);
    return new T.MeshStandardMaterial({
      color: col,
      map: t,
      bumpMap: t,
      bumpScale: 2,
      roughness: 0.48,
      metalness: 0.3,
      side: T.DoubleSide,
    });
  };
  const mF = sk(1),
    mW = sk(0.3),
    mW2 = sk(0.3, 0xb8bdc2),
    dk = new T.MeshStandardMaterial({ color: 0x08090a, roughness: 0.7 }),
    met = new T.MeshStandardMaterial({
      color: 0x5a534c,
      roughness: 0.42,
      metalness: 0.9,
      flatShading: true,
      side: T.DoubleSide,
    }),
    gls = new T.MeshStandardMaterial({
      color: 0xc79a3e,
      roughness: 0.04,
      metalness: 1,
      transparent: true,
      opacity: 0.34,
      envMapIntensity: 1.8,
      depthWrite: false,
    });
  const M = (g, m, x = 0, y = 0, z = 0) => {
    const o = new T.Mesh(g, m);
    o.position.set(x, y, z);
    return o;
  };
  const two = (o, to = P) => {
    to.add(o);
    const w = new T.Group();
    w.add(o.clone());
    w.scale.x = -1;
    to.add(w);
    return w.children[0];
  };
  // Fuselaje por secciones [z, semiancho, semialto, y]
  const loft = (s, n = 56) => {
    const v = [],
      u = [],
      ix = [];
    s.forEach(([z, w, h, y], j) => {
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * 6.2832,
          c = Math.cos(a),
          k = Math.sin(a);
        v.push(Math.sign(c) * Math.abs(c) ** 0.85 * w, y + Math.sign(k) * Math.abs(k) ** 0.85 * h, z);
        u.push((i / n) * 3, (j / (s.length - 1)) * 3);
      }
    });
    for (let j = 0; j < s.length - 1; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i,
          b = a + n + 1;
        ix.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(u, 2));
    g.setIndex(ix);
    g.computeVertexNormals();
    return g;
  };
  const slabH = (pts, th) => {
    const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z))), {
      depth: th,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 2,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -th / 2, 0);
    return g;
  };
  const slabV = (pts, th) => {
    const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([z, y]) => new T.Vector2(-z, y))), {
      depth: th,
      bevelSize: 0.015,
      bevelThickness: 0.015,
      bevelSegments: 2,
    });
    g.rotateY(Math.PI / 2);
    g.translate(-th / 2, 0, 0);
    return g;
  };
  P.add(
    M(
      loft([
        [5.4, 0.52, 0.5, 0.02],
        [4.6, 0.64, 0.6, 0.05],
        [3.6, 0.78, 0.72, 0.08],
        [2.4, 0.92, 0.8, 0.05],
        [1, 1.1, 0.82, 0],
        [-1, 1.2, 0.85, -0.02],
        [-3, 1.18, 0.85, -0.04],
        [-5, 1, 0.8, -0.02],
        [-6.9, 0.66, 0.66, 0],
      ]),
      mF,
    ),
  );
  P.add(
    M(
      loft([
        [1.4, 0.08, 0.08, 0.72],
        [-0.5, 0.4, 0.25, 0.76],
        [-3, 0.5, 0.3, 0.7],
        [-5.6, 0.22, 0.2, 0.5],
      ]),
      mF,
    ),
  );
  // Radomo y sonda pitot
  {
    const p = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      p.push(new T.Vector2(0.52 * Math.sqrt(1 - t ** 1.8), 2.6 * t));
    }
    P.add(
      M(
        new T.LatheGeometry(p, 40).rotateX(Math.PI / 2),
        new T.MeshStandardMaterial({ color: 0x5d6368, roughness: 0.4, metalness: 0.2 }),
        0,
        0.02,
        5.4,
      ),
    );
    P.add(M(new T.CylinderGeometry(0.015, 0.03, 0.9, 8).rotateX(Math.PI / 2), met, 0, 0.02, 8.4));
  }
  // Entrada de aire ventral
  P.add(
    M(
      loft(
        [
          [3.9, 0.5, 0.36, -0.78],
          [3.1, 0.62, 0.44, -0.74],
          [1.8, 0.8, 0.55, -0.65],
          [0.4, 1, 0.6, -0.45],
        ],
        40,
      ),
      mF,
    ),
  );
  {
    const d = M(new T.CircleGeometry(1, 32).scale(0.46, 0.32, 1), dk, 0, -0.78, 3.89);
    P.add(d);
    P.add(M(new T.BoxGeometry(0.04, 0.5, 0.6), mF, 0, -0.86, 3.5));
  }
  // Cabina: capota, arcos, piloto y asiento
  P.add(M(new T.SphereGeometry(1, 48, 24, 0, 6.2832, 0, 1.5708).scale(0.55, 0.6, 1.9), gls, 0, 0.62, 2.6));
  [
    [3.9, 0.43],
    [1.5, 0.46],
  ].forEach(([z, r]) => {
    const a = M(new T.TorusGeometry(r, 0.03, 8, 32, Math.PI), dk, 0, 0.64, z);
    P.add(a);
  });
  P.add(
    M(
      new T.SphereGeometry(0.16, 24, 16),
      new T.MeshStandardMaterial({ color: 0xd0d3d6, roughness: 0.35 }),
      0,
      0.86,
      2.6,
    ),
    M(new T.BoxGeometry(0.5, 0.75, 0.12), dk, 0, 0.55, 2.0),
    M(new T.BoxGeometry(0.7, 0.06, 0.3), dk, 0, 0.78, 3.7),
  );
  // Alas, flaps, strakes, estabilizadores, deriva, aletas ventrales
  const gear = buildF16Rig(P, M, slabH, slabV, { wing: mW, trim: mW2, dark: dk, metal: met });
  P.add(
    M(new T.BoxGeometry(0.1, 0.18, 0.9), dk, 0, 3.55, -6.9),
    M(new T.CylinderGeometry(0.008, 0.008, 0.4, 6), met, 0, 3.7, -6.6),
  );
  {
    const v = M(
      slabV(
        [
          [-5, -0.2],
          [-6.1, -0.9],
          [-6.8, -0.9],
          [-6.5, -0.2],
        ],
        0.07,
      ),
      mW,
    );
    const g = new T.Group();
    g.add(v);
    g.position.set(0.75, -0.5, 0);
    g.rotation.z = -0.5;
    two(g);
  }
  // Tobera con postquemador
  P.add(
    M(new T.CylinderGeometry(0.66, 0.56, 1.3, 28, 1, true).rotateX(Math.PI / 2), met, 0, 0, -7.5),
    M(new T.TorusGeometry(0.66, 0.05, 8, 32), met, 0, 0, -6.9),
    M(new T.CircleGeometry(0.55, 24), dk, 0, 0, -7.1),
  );
  const ab = new T.Group();
  ab.name = 'Afterburner';
  const fm = (c) =>
    new T.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.7,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      depthWrite: false,
    });
  const f1 = new T.Mesh(new T.ConeGeometry(0.5, 3.4, 24, 1, true).rotateX(-Math.PI / 2), fm(0xff8a2e)),
    f2 = new T.Mesh(new T.ConeGeometry(0.3, 2, 24, 1, true).rotateX(-Math.PI / 2), fm(0xbfd8ff));
  f1.position.z = -9.3;
  f2.position.z = -8.6;
  const fli = new T.PointLight(0xff8a30, 2, 10);
  fli.position.z = -9;
  ab.add(f1, f2, fli);
  ab.visible = false;
  P.add(ab);
  // Armamento: AIM-9 en puntas, AIM-120 y depósitos subalares
  const rkt = (len, r, fin) => {
    const g = new T.Group(),
      p = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      p.push(new T.Vector2(r * Math.min(1, ((1 - t) / 0.18) ** 0.7), t * len));
    }
    g.add(
      M(
        new T.LatheGeometry(p, 20).rotateX(Math.PI / 2).translate(0, 0, -len / 2),
        new T.MeshStandardMaterial({ color: 0xcfd2d4, roughness: 0.4, metalness: 0.4 }),
      ),
    );
    for (let k = 0; k < 4; k++) {
      const f = new T.Group();
      f.add(M(new T.BoxGeometry(0.012, r * 4.2, fin), dk, 0, r * 1.6, -len / 2 + fin / 2));
      f.rotation.z = (k * Math.PI) / 2 + Math.PI / 4;
      g.add(f);
    }
    return g;
  };
  const tank = (len, r) => {
    const p = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      p.push(new T.Vector2(r * Math.sin(Math.PI * t) ** 0.35, t * len));
    }
    return M(new T.LatheGeometry(p, 28).rotateX(Math.PI / 2).translate(0, 0, -len / 2), mF);
  };
  const arm = new T.Group();
  arm.name = 'External stores';
  P.add(arm);
  const stations = [];
  {
    const a = rkt(2.9, 0.063, 0.45);
    a.position.fromArray(wingStores.wingtip);
    const tip = two(a, arm);
    a.name = 'wingtip-left';
    tip.name = 'wingtip-right';
    stations.push({ name: 'wingtip', left: a, right: tip });
    const b = new T.Group();
    b.add(M(new T.BoxGeometry(0.05, 0.22, 1.3), mW, 0, -0.12, 0), rkt(3.66, 0.09, 0.5));
    b.children[1].position.set(0, -wingStores.outerDrop, 0);
    b.position.fromArray(wingStores.outer);
    const outer = two(b, arm);
    b.children[1].name = 'outer-left';
    outer.children[1].name = 'outer-right';
    stations.push({ name: 'outer pylon', left: b, right: outer });
    const c = new T.Group();
    c.add(M(new T.BoxGeometry(0.06, 0.3, 1.4), mW, 0, -0.15, 0), tank(4.6, 0.33));
    c.children[1].position.set(0, -0.5, 0);
    c.position.set(1.9, -0.3, -1.9);
    const inner = two(c, arm);
    stations.push({ name: 'inner pylon', left: c, right: inner });
  }
  // Luces de navegación
  const nav = (c, x, y, z) => {
    const m = new T.Mesh(new T.SphereGeometry(0.07, 12, 8), new T.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z);
    P.add(m);
    return m;
  };
  nav(0xff2020, 5.3, -0.22, -2.6);
  nav(0x20ff40, -5.3, -0.22, -2.6);
  const strobe = nav(0xffffff, 0, 3.45, -7.6);
  strobe.name = 'Tail strobe';

  const muzzle = cannonMount(f16.cannon);
  root.add(muzzle);
  for (const { left, right } of stations) {
    left.userData.wing = 'leftWing';
    right.userData.wing = 'rightWing';
  }
  return { ...animate(root, muzzle, gear, arm, ab, strobe), stations, paint: [mF, mW, mW2] };
}

export function createOpponentVisual(source, hostile = true) {
  const root = source.root.clone();
  const colors = [0xab7770, 0xbd8a75, 0xe9ab82];
  const palette = new Map((hostile ? source.paint : []).map((material, index) => {
    const paint = material.clone();
    paint.color.setHex(colors[index]);
    return [material, paint];
  }));
  root.traverse((object) => {
    if (palette.has(object.material)) object.material = palette.get(object.material);
  });
  const ab = root.getObjectByName(source.ab.name);
  if (hostile && ab.children[2]) ab.remove(ab.children[2]);
  const muzzle = root.getObjectByName(source.muzzle.name);
  muzzle.clear();
  return { ...animate(root, muzzle, root.getObjectByName(source.gear.name),
    root.getObjectByName(source.arm.name), ab, root.getObjectByName(source.strobe.name)),
    paint: hostile ? [...palette.values()] : source.paint };

}

function animate(root, muzzle, gear, arm, ab, strobe) {
  const [f1, f2, fli] = ab.children;
  const updateRig = bindF16Rig(root);
  return {
    root,
    airframe: root.getObjectByName('F-16C airframe'),
    muzzle,
    gear,
    arm,
    ab,
    strobe,
    update(state, time, blend = 1) {
      updateRig(state, blend);
      arm.visible = state.stores;
      ab.visible = state.afterburner;
      if (ab.visible) {
        const flicker = Math.sin(time * 71) * 0.025;
        f1.scale.set(1 + flicker, 1 + flicker, 1 + Math.sin(time * 45) * 0.07);
        f2.scale.z = 1 + Math.sin(time * 60) * 0.1;
        if (fli) fli.intensity = 12 + Math.sin(time * 49) * 1.2;
      }
      strobe.visible = time % 1.4 < 0.12;
    },
  };
}
