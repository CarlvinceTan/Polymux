import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [{
    name: 'electron-preload-rolldown-options',
    configResolved(config) {
      const output = config.build.rollupOptions.output;
      if (output && !Array.isArray(output)) delete output.inlineDynamicImports;
    },
  }],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
