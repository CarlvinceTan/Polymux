/** Measured from screen captures of the running app: this macOS draws 14pt
 * lights on 23pt centres, and the position is the top-left of the red light —
 * at {27,26} its centre lands on (33.8, 32.8), i.e. position + 7. The title
 * bar's control line is y=26 (28px renderer buttons at top 12px), so
 * 26 - 7 = 19 centres the lights on it. The unfocused stand-in dots in
 * style.css use the same origin and size, so focus changes swap colour
 * without the lights moving or resizing. */
export const FLAREAI_TRAFFIC_LIGHT_POSITION = {x: 19, y: 19} as const;

export interface MacWindowButtons {
  setWindowButtonVisibility(visible: boolean): void;
  setWindowButtonPosition(position: {x: number; y: number} | null): void;
}

/** macOS resets the traffic-light coordinates when hidden native buttons are
 * made visible again, so visibility and placement must be restored together. */
export function syncMacWindowButtons(
  window: MacWindowButtons,
  focused: boolean,
): void {
  window.setWindowButtonVisibility(focused);
  if (focused) window.setWindowButtonPosition(FLAREAI_TRAFFIC_LIGHT_POSITION);
}
