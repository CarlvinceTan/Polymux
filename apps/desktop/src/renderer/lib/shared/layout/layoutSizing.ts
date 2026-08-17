// The conversation never compresses below a readable measure, so both side
// surfaces resize against this floor rather than against the viewport alone.
export const MIN_MAIN_PANE_WIDTH = 432;
export const MIN_CHAT_DRAWER_WIDTH = 180;
export const MAX_CHAT_DRAWER_WIDTH = 480;
export const MIN_WORKSPACE_WIDTH = 360;
export const MAX_WORKSPACE_WIDTH = 720;
export const SPLIT_LAYOUT_MIN_WIDTH = MIN_CHAT_DRAWER_WIDTH + MIN_MAIN_PANE_WIDTH + MIN_WORKSPACE_WIDTH + 1;
// Space reserved for the Summary card and its horizontal insets. Keep the
// matching fixed sizes in style.css in step with this value.
export const SUMMARY_RESERVED_COLUMN = 337;

export type ResizeBounds = {min: number; max: number};

function bounds(viewportWidth: number, reservedWidth: number, minimum: number, maximum: number): ResizeBounds {
  return {
    min: minimum,
    max: Math.max(minimum, Math.min(maximum, viewportWidth - reservedWidth - MIN_MAIN_PANE_WIDTH)),
  };
}

export function chatDrawerResizeBounds(viewportWidth: number, workspaceWidth: number): ResizeBounds {
  return bounds(viewportWidth, workspaceWidth, MIN_CHAT_DRAWER_WIDTH, MAX_CHAT_DRAWER_WIDTH);
}

export function workspaceResizeBounds(viewportWidth: number, chatDrawerWidth: number): ResizeBounds {
  return bounds(viewportWidth, chatDrawerWidth, MIN_WORKSPACE_WIDTH, MAX_WORKSPACE_WIDTH);
}

export function clampPanelWidth(width: number, resizeBounds: ResizeBounds): number {
  return Math.round(Math.max(resizeBounds.min, Math.min(resizeBounds.max, width)));
}

export interface PanelLayoutRequest {
  viewportWidth: number;
  chatDrawerOpen: boolean;
  workspaceOpen: boolean;
  chatDrawerWidth: number;
  workspaceWidth: number;
  /** The drawer whose width reflects the most recent user intent. */
  priority: "chatDrawer" | "workspace";
}

export interface PanelLayout {
  chatDrawerWidth: number;
  workspaceWidth: number;
}

/**
 * Resolves both drawer widths against the conversation floor. Each drawer may
 * grow into the other's space — its bounds reserve only the other's minimum —
 * and any overflow is settled by shrinking the drawer the user touched least
 * recently down to its own minimum before the prioritised one gives way. The
 * conversation column therefore never drops below MIN_MAIN_PANE_WIDTH, and no
 * open drawer is ever pushed below its own minimum.
 */
export function resolvePanelWidths(request: PanelLayoutRequest): PanelLayout {
  const {viewportWidth} = request;
  let chats = request.chatDrawerOpen
    ? clampPanelWidth(request.chatDrawerWidth, chatDrawerResizeBounds(viewportWidth, request.workspaceOpen ? MIN_WORKSPACE_WIDTH : 0))
    : request.chatDrawerWidth;
  let workspace = request.workspaceOpen
    ? clampPanelWidth(request.workspaceWidth, workspaceResizeBounds(viewportWidth, request.chatDrawerOpen ? MIN_CHAT_DRAWER_WIDTH : 0))
    : request.workspaceWidth;
  if (request.chatDrawerOpen && request.workspaceOpen) {
    const overflow = () => chats + workspace + MIN_MAIN_PANE_WIDTH - viewportWidth;
    if (overflow() > 0) {
      if (request.priority === "chatDrawer") workspace = Math.max(MIN_WORKSPACE_WIDTH, workspace - overflow());
      else chats = Math.max(MIN_CHAT_DRAWER_WIDTH, chats - overflow());
    }
    if (overflow() > 0) {
      if (request.priority === "chatDrawer") chats = Math.max(MIN_CHAT_DRAWER_WIDTH, chats - overflow());
      else workspace = Math.max(MIN_WORKSPACE_WIDTH, workspace - overflow());
    }
  }
  return {chatDrawerWidth: Math.round(chats), workspaceWidth: Math.round(workspace)};
}
