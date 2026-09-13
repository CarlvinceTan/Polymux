import type {AgentTool} from "@polymux/core";
import type {PhoneFrameDto, PhonePointDto, PhoneStatusDto} from "@polymux/protocol";

export interface PhoneAutomation {
  status(): Promise<PhoneStatusDto>;
  connect(): Promise<PhoneStatusDto>;
  frame(): Promise<PhoneFrameDto>;
  tap(point: PhonePointDto): Promise<void>;
  swipe(from: PhonePointDto, to: PhonePointDto, durationMs?: number): Promise<void>;
  type(text: string): Promise<void>;
  home(): Promise<void>;
}

/** The same WDA session the owner sees in PhoneView, exposed to the main agent. */
export function createPhoneTool(phone: PhoneAutomation): AgentTool {
  return {
    name: "phone_control",
    description: [
      "Inspect and control the owner's connected iPhone when they ask you to use their phone.",
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
      if (input.action === "status") return {content: JSON.stringify(modelStatus(await phone.status()))};
      if (input.action === "connect") return {content: JSON.stringify(modelStatus(await phone.connect()))};
      if (input.action === "screenshot") return screenshotResult(await phone.frame());
      if (input.action === "tap") {
        await phone.tap(point(input.x, input.y));
        return {content: JSON.stringify({tapped: {x: input.x, y: input.y}})};
      }
      if (input.action === "swipe") {
        await phone.swipe(point(input.x, input.y), point(input.toX, input.toY), number(input.durationMs));
        return {content: JSON.stringify({swiped: {from: {x: input.x, y: input.y}, to: {x: input.toX, y: input.toY}}})};
      }
      if (input.action === "type") {
        if (typeof input.text !== "string") return {content: "text is required for type", isError: true};
        await phone.type(input.text);
        return {content: JSON.stringify({typed: true, characters: input.text.length})};
      }
      if (input.action === "home") {
        await phone.home();
        return {content: JSON.stringify({pressed: "home"})};
      }
      return {content: "Unsupported phone action.", isError: true};
    },
  };
}

function screenshotResult(frame: PhoneFrameDto) {
  return {
    content: [
      {type: "text" as const, text: JSON.stringify({width: frame.width, height: frame.height, capturedAt: frame.capturedAt})},
      {type: "image" as const, data: frame.dataUrl.replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" as const},
    ],
  };
}

function modelStatus(status: PhoneStatusDto) {
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

function point(x: unknown, y: unknown): PhonePointDto {
  if (typeof x !== "number" || typeof y !== "number") throw new Error("x and y are required screen coordinates.");
  return {x, y};
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
