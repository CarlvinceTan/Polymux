import type { MidasApi } from "@midas/protocol";

declare global {
  interface Window {
    midas: MidasApi;
  }
}

export {};
