# Midas

Midas is an Electron Forge desktop app with a Svelte frontend. The agent/backend
is intentionally not implemented yet.

```sh
npm install
npm start
```

Other useful commands:

```sh
npm run check
npm run package
npm run make
```

The structure follows Electron Forge's first-party `vite-typescript` template:

- `src/main/` — Electron main process
- `src/preload/` — secure renderer bridge (currently empty)
- `src/renderer/` — the ported Svelte frontend
