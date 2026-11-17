import { defineConfig } from 'vite';

// Builds the standalone avatar runtime into a single IIFE string that the
// editor embeds into exported HTML files.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'src/generated',
    emptyOutDir: false,
    lib: {
      entry: 'src/player/player.ts',
      formats: ['iife'],
      name: 'StillwavePlayer',
      fileName: () => 'player.iife.js',
    },
    minify: true,
  },
});
