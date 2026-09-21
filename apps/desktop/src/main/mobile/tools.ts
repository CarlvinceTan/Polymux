import type {AgentTool} from "@polymux/core";
import type {MobileFrameDto, MobilePointDto, MobileStatusDto} from "@polymux/protocol";

export interface MobileAutomation {
  status(): Promise<MobileStatusDto>;
  connect(): Promise<MobileStatusDto>;
  frame(): Promise<MobileFrameDto>;
  tap(point: MobilePointDto): Promise<void>;
  swipe(from: MobilePointDto, to: MobilePointDto, durationMs?: number): Promise<void>;
  type(text: string): Promise<void>;
  home(): Promise<void>;
}

/** The same WDA session the owner sees in MobileView, exposed to the main agent. */
export function createMobileTool(mobile: MobileAutomation): AgentTool {
  return {
    name: "mobile_control",
    description: [
      "Inspect and control the owner's connected iPhone when they ask you to use their mobile.",
      "Use status or connect first, then screenshot before choosing coordinates.",
      "Coordinates are in the screenshot's logical width and height.",
      "Actions: status, connect, screenshot, tap, swipe, type, home.",
      "Never infer that an action succeeded from the request alone; take another screenshot.",
    ].join(" "),
    mainAgentOnly: true,
    parameters: {
      type: "object",
      properties: {
        action: {type: "string", enum: ["status", "connect", "screenshot", "tap", "swipe", "type", "home"]},
        x: {type: "number"},
        y: {type: "number"},
        toX: {type: "number"},
        toY: {type: "number"},
        durationMs: {type: "number"},
        text: {type: "string"},
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input) {
      if (input.action === "status") return {content: JSON.stringify(modelStatus(await mobile.status()))};
      if (input.action === "connect") return {content: JSON.stringify(modelStatus(await mobile.connect()))};
      if (input.action === "screenshot") return screenshotResult(await mobile.frame());
      if (input.action === "tap") {
        await mobile.tap(point(input.x, input.y));
        return {content: JSON.stringify({tapped: {x: input.x, y: input.y}})};
      }
      if (input.action === "swipe") {
        await mobile.swipe(point(input.x, input.y), point(input.toX, input.toY), number(input.durationMs));
        return {content: JSON.stringify({swiped: {from: {x: input.x, y: input.y}, to: {x: input.toX, y: input.toY}}})};
      }
      if (input.action === "type") {
        if (typeof input.text !== "string") return {content: "text is required for type", isError: true};
        await mobile.type(input.text);
        return {content: JSON.stringify({typed: true, characters: input.text.length})};
      }
      if (input.action === "home") {
        await mobile.home();
        return {content: JSON.stringify({pressed: "home"})};
      }
      return {content: "Unsupported mobile action.", isError: true};
    },
  };
}

function screenshotResult(frame: MobileFrameDto) {
  return {
    content: [
      {type: "text" as const, text: JSON.stringify({width: frame.width, height: frame.height, capturedAt: frame.capturedAt})},
      {type: "image" as const, data: frame.dataUrl.replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" as const},
    ],
  };
}

function modelStatus(status: MobileStatusDto) {
  return {
    supported: status.supported,
    stage: status.stage,
    device: status.device ? {
      model: status.device.model,
      osVersion: status.device.osVersion,
      transport: status.device.transport,
      pairingState: status.device.pairingState,
      developerMode: status.device.developerMode,
    } : null,
    signing: {
      available: status.signing.available,
      source: status.signing.source,
      expiresAt: status.signing.expiresAt,
      message: status.signing.message,
    },
    wda: {
      available: status.wda.available,
      installed: status.wda.installed,
      running: status.wda.running,
    },
    controller: status.controller,
    message: status.message,
  };
}

function point(x: unknown, y: unknown): MobilePointDto {
  if (typeof x !== "number" || typeof y !== "number") throw new Error("x and y are required screen coordinates.");
  return {x, y};
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
