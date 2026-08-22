import type {AgentTool} from "@flareai/core";

export interface RendererInspectionSnapshot {
  image: {data: string; mimeType: "image/png"};
  text: string;
  images: Array<{alt: string; source: string; loaded: boolean; width: number; height: number}>;
}

export interface RendererInspector {
  openSettings(mode: "memory"): Promise<void>;
  snapshot(): Promise<RendererInspectionSnapshot>;
}

/** Renderer-scoped visual evidence for FlareAI's own UI. It never shows,
 * focuses, raises, or synthesizes input into the window. */
export function createFlareAIUiInspectionTool(inspector: RendererInspector): AgentTool {
  return {
    name: "flareai_ui_inspect",
    description:
      "Inspect FlareAI's actual rendered UI without showing or focusing its window. Use for claims about what a FlareAI settings screen visibly renders, rather than inferring from backend or source code. The only supported view is Memory settings. This navigates the renderer read-only and returns both a PNG and semantic image-load evidence; it does not change settings.",
    parameters: {
      type: "object",
      properties: {view: {type: "string", enum: ["memory"]}},
      required: ["view"],
      additionalProperties: false,
    },
    // Keep this usable on OpenCode Go and local OpenAI-compatible providers
    // that validate tool schemas but cannot guarantee constrained sampling.
    strict: "prefer",
    async execute(input) {
      if (input.view !== "memory") return {content: "Unsupported FlareAI UI view.", isError: true};
      await inspector.openSettings("memory");
      const snapshot = await inspector.snapshot();
      return {
        content: [
          {type: "text", text: JSON.stringify({view: "memory", renderedText: snapshot.text, images: snapshot.images})},
          {type: "image", data: snapshot.image.data, mimeType: snapshot.image.mimeType},
        ],
      };
    },
  };
}
