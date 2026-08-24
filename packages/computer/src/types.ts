export type SurfaceKind = "app" | "window" | "tab";
export type SurfaceView = "apps" | "windows" | "tabs";

export interface SurfaceCapabilities {
  read: boolean;
  control: boolean;
  background: boolean;
  scopes: Array<"element" | "tab" | "window" | "app">;
}

export interface ComputerSurface {
  id: string;
  kind: SurfaceKind;
  parentId?: string;
  app: string;
  title?: string;
  url?: string;
  frontmost: boolean;
  active: boolean;
  userControlled: boolean;
  capturedAt?: string;
  lastUserEvent?: {
    kind: "app" | "click" | "shortcut" | "type" | "scroll";
    at: string;
    count?: number;
  };
  capabilities: SurfaceCapabilities;
}

export interface ComputerActivityEvent {
  at: string;
  kind: "app" | "click" | "shortcut" | "type" | "scroll";
  app: string;
  title?: string;
  url?: string;
  count?: number;
}

export interface ComputerUserState {
  surfaceId?: string;
  app?: string;
  kind?: SurfaceKind;
  capturedAt?: string;
  locked: boolean;
}

export interface ComputerStateInput {
  windowsCapturedAt?: string;
  browserTabsCapturedAt?: string;
  externalBrowserCapturedAt?: string;
  locked?: boolean;
  windows?: Array<{ app: string; title: string; frontmost: boolean }>;
  browserTabs?: Array<{ tabId: string; url: string; title: string }>;
  externalBrowserTabs?: Array<{
    tabId: number;
    windowId: number | null;
    url: string;
    title: string;
    active: boolean;
  }>;
}

export interface ComputerStateQuery {
  surfaces?: SurfaceView[];
  app?: string;
}

export interface ComputerStateResult {
  user: ComputerUserState;
  surfaces: ComputerSurface[];
  counts: Record<SurfaceView, number>;
}

export type ControlScope = "element" | "tab" | "window" | "app";
export type ControlOperation = "read" | "press" | "type" | "scroll" | "navigate" | "close" | "reorganize";

export interface ControlRequest {
  ownerId: string;
  surfaceId: string;
  operation: ControlOperation;
  scope: ControlScope;
  explicitlyRequested?: boolean;
}

export interface ControlDecision {
  decision: "allow" | "allow_background_only" | "read_only" | "pause" | "deny";
  reason: string;
  token?: string;
  constraints?: {
    surfaceId: string;
    scope: ControlScope;
    mustRemainBackground: boolean;
  };
}
