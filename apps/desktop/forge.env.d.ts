/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

/** Vite inlines the file's text at build time; used for the scripts the in-app
 * Browser injects into a page. */
declare module "*?raw" {
  const source: string;
  export default source;
}
