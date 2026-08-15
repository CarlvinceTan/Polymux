// Every chrome-level icon button in the app draws at one size and one weight, so
// the title bar, drawer and panel controls read as a single set.
export const MAIN_UI_ICON_SIZE = 16;
export const MAIN_UI_ICON_STROKE_WIDTH = 1.5;
// The gear's teeth push right to the edge of its box, so at the shared size it
// reads heavier than the flat-sided icons beside it. It draws a notch smaller
// to land on the same optical weight.
export const SETTINGS_ICON_SIZE = 13;
// Strokes are authored in the shared 24-unit box, so they thin as the icon
// shrinks. The gear scales its stroke back up to land on the same rendered
// line weight as the icons beside it.
export const SETTINGS_ICON_STROKE_WIDTH = Math.round(
  MAIN_UI_ICON_STROKE_WIDTH * (MAIN_UI_ICON_SIZE / SETTINGS_ICON_SIZE) * 100) / 100;
// Sidebar rows mix outline glyphs with solid brand tiles. A tile inks its whole
// box, so at a shared size it dwarfs the hairline glyph beside it — it draws
// smaller, the same trade the gear makes above.
export const RAIL_ICON_SIZE = 15;
export const RAIL_TILE_SIZE = 13;
// Every row reserves the same slot so the labels start on one line regardless
// of which kind of icon leads them.
export const RAIL_ICON_SLOT = 17;
