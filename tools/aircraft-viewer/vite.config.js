import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // The standalone viewer shares its hinge posing code with the game.
    fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] },
  },
});
