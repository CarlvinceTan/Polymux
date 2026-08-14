// The conversation never compresses below a readable measure, so both side
// surfaces resize against this floor rather than against the viewport alone.
export const MIN_MAIN_PANE_WIDTH = 432;
export const MIN_HISTORY_WIDTH = 180;
export const MAX_HISTORY_WIDTH = 480;
export const MIN_WORKSPACE_WIDTH = 360;
export const MAX_WORKSPACE_WIDTH = 720;
export const SPLIT_LAYOUT_MIN_WIDTH = MIN_HISTORY_WIDTH + MIN_MAIN_PANE_WIDTH + MIN_WORKSPACE_WIDTH + 1;
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

export function historyResizeBounds(viewportWidth: number, workspaceWidth: number): ResizeBounds {
  return bounds(viewportWidth, workspaceWidth, MIN_HISTORY_WIDTH, MAX_HISTORY_WIDTH);
}

export function workspaceResizeBounds(viewportWidth: number, historyWidth: number): ResizeBounds {
  return bounds(viewportWidth, historyWidth, MIN_WORKSPACE_WIDTH, MAX_WORKSPACE_WIDTH);
}

export function clampPanelWidth(width: number, resizeBounds: ResizeBounds): number {
  return Math.round(Math.max(resizeBounds.min, Math.min(resizeBounds.max, width)));
}

export interface PanelLayoutRequest {
  viewportWidth: number;
  historyOpen: boolean;
  workspaceOpen: boolean;
  historyWidth: number;
  workspaceWidth: number;
  /** The drawer whose width reflects the most recent user intent. */
  priority: "history" | "workspace";
}

export interface PanelLayout {
  historyWidth: number;
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
  let history = request.historyOpen
    ? clampPanelWidth(request.historyWidth, historyResizeBounds(viewportWidth, request.workspaceOpen ? MIN_WORKSPACE_WIDTH : 0))
    : request.historyWidth;
  let workspace = request.workspaceOpen
    ? clampPanelWidth(request.workspaceWidth, workspaceResizeBounds(viewportWidth, request.historyOpen ? MIN_HISTORY_WIDTH : 0))
    : request.workspaceWidth;
  if (request.historyOpen && request.workspaceOpen) {
    const overflow = () => history + workspace + MIN_MAIN_PANE_WIDTH - viewportWidth;
    if (overflow() > 0) {
      if (request.priority === "history") workspace = Math.max(MIN_WORKSPACE_WIDTH, workspace - overflow());
      else history = Math.max(MIN_HISTORY_WIDTH, history - overflow());
    }
    if (overflow() > 0) {
      if (request.priority === "history") history = Math.max(MIN_HISTORY_WIDTH, history - overflow());
      else workspace = Math.max(MIN_WORKSPACE_WIDTH, workspace - overflow());
    }
  }
  return {historyWidth: Math.round(history), workspaceWidth: Math.round(workspace)};
}
