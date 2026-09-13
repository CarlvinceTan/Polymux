import {qrMatrix} from "@polymux/protocol";

const QUIET_ZONE = 4;
const BLACK_ON_WHITE = "\u001b[30;47m";
const RESET = "\u001b[0m";

/** Render two QR modules per terminal row while forcing reliable contrast. */
export function terminalQr(text: string): string {
  const modules = qrMatrix(text);
  const edge = modules.length + QUIET_ZONE;
  const dark = (row: number, column: number): boolean =>
    row >= 0 && row < modules.length
    && column >= 0 && column < modules.length
    && modules[row]![column]!;
  const lines: string[] = [];

  for (let row = -QUIET_ZONE; row < edge; row += 2) {
    let line = "";
    for (let column = -QUIET_ZONE; column < edge; column += 1) {
      const top = dark(row, column);
      const bottom = dark(row + 1, column);
      line += top ? (bottom ? "█" : "▀") : (bottom ? "▄" : " ");
    }
    lines.push(`${BLACK_ON_WHITE}${line}${RESET}`);
  }

  return lines.join("\n");
}
