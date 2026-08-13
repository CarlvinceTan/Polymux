import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron-squirrel-startup'],
    },
    lib: {
      entry: 'src/main/main.ts',
      fileName: () => 'main.js',
      formats: ['es'],
    },
  },
});
