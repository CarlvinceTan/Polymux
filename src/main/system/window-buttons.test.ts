import assert from "node:assert/strict";
import test from "node:test";
import {
  FLAREAI_TRAFFIC_LIGHT_POSITION,
  syncMacWindowButtons,
  type MacWindowButtons,
} from "./window-buttons.js";

class ResettingMacWindow implements MacWindowButtons {
  visible = true;
  position: {x: number; y: number} = {...FLAREAI_TRAFFIC_LIGHT_POSITION};
  calls: string[] = [];

  setWindowButtonVisibility(visible: boolean): void {
    this.calls.push(`visible:${visible}`);
    this.visible = visible;
    // AppKit/Electron restores the standard coordinates when the native
    // controls return, which is the regression this test protects against.
    if (visible) this.position = {x: 12, y: 12};
  }

  setWindowButtonPosition(position: {x: number; y: number} | null): void {
    this.calls.push(`position:${position?.x},${position?.y}`);
    if (position) this.position = {...position};
  }
}

test("keeps native traffic lights at the FlareAI position across focus cycles", () => {
  const window = new ResettingMacWindow();

  syncMacWindowButtons(window, false);
  assert.equal(window.visible, false);
  assert.deepEqual(window.calls, ["visible:false"]);

  syncMacWindowButtons(window, true);
  assert.equal(window.visible, true);
  assert.deepEqual(window.position, FLAREAI_TRAFFIC_LIGHT_POSITION);
  assert.deepEqual(window.calls.slice(-2), ["visible:true", "position:19,19"]);

  syncMacWindowButtons(window, false);
  syncMacWindowButtons(window, true);
  assert.deepEqual(window.position, FLAREAI_TRAFFIC_LIGHT_POSITION);
});
