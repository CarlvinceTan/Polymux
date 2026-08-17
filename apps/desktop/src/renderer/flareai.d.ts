import type { FlareAIApi } from "@flareai/protocol";

declare global {
  interface Window {
    flareai: FlareAIApi;
  }
}

export {};
