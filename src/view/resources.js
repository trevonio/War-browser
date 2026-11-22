export function disposeObjects(...roots) {
  const geometry = new Set();
  const materials = new Set();
  const textures = new Set();
  for (const root of roots) {
    root.removeFromParent();
    root.traverse((node) => {
      if (node.geometry) geometry.add(node.geometry);
      if (node.material) {
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of list) materials.add(material);
      }
      if (node.isInstancedMesh) node.dispose();
    });
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const shape of geometry) shape.dispose();
}
