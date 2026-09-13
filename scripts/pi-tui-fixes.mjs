import { readFile } from "node:fs/promises";

// Bundle-owned fix for pi-tui 0.85.1. Never mutates installed dependencies.
// Earlier ANSI styles must precede resets at a slice boundary, otherwise a
// selected cursor's inverse style leaks across the remaining editor padding.
export const piTuiFixes = {
  name: "polymux-terminal-style-boundaries",
  setup(build) {
    build.onLoad(
      { filter: /pi-tui[\\/]dist[\\/]utils\.js$/ },
      async ({ path }) => {
        const source = await readFile(path, "utf8");
        const before = `if (currentCol >= startCol && currentCol < endCol)\n                result += ansi.code;`;
        if (source.split(before).length !== 2)
          throw new Error(
            "pi-tui slice implementation changed; review the terminal style fix before upgrading",
          );
        return {
          contents: source.replace(
            before,
            `if (currentCol >= startCol && currentCol < endCol) {\n                result += pendingAnsi + ansi.code;\n                pendingAnsi = "";\n            }`,
          ),
          loader: "js",
        };
      },
    );
  },
};
