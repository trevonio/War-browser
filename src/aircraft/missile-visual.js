import * as T from 'three';

export function missileVisuals() {
  const shell = new T.MeshStandardMaterial({ color: 0xd8dbd6, roughness: 0.43, metalness: 0.42 });
  const fins = new T.MeshStandardMaterial({ color: 0x5f6870, roughness: 0.51 });
  const models = {};
  for (const [type, length, radius] of [['infrared', 2.85, 0.064], ['radar', 3.58, 0.09]]) {
    const model = new T.Group();
    const profile = [[radius * 0.88, -length / 2], [radius, -length * 0.3],
      [radius, length * 0.27], [radius * 0.51, length * 0.47], [0, length / 2]];
    const body = new T.LatheGeometry(profile.map(([x, y]) => new T.Vector2(x, y)), 10).rotateX(Math.PI / 2);
    model.add(new T.Mesh(body, shell));
    const shape = new T.BoxGeometry(0.025, radius * 2.8, length * 0.14);
    for (let i = 0; i < 4; i++) {
      const pivot = new T.Group();
      pivot.rotation.z = Math.PI * i / 2 + Math.PI / 4;
      const fin = new T.Mesh(shape, fins);
      fin.position.set(0, radius * 1.55, -length * 0.36);
      pivot.add(fin);
      model.add(pivot);
    }
    models[type] = model;
  }
  return models;
}
