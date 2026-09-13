import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

test("bundled terminal slices replay prior styles before boundary resets", async () => {
  const { piTuiFixes } = await import(
    pathToFileURL(path.resolve("scripts/pi-tui-fixes.mjs")).href
  );
  const result = await build({
    stdin: {
      contents: `export {sliceByColumn} from ${JSON.stringify(path.join(path.dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-tui")), "utils.js"))};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [piTuiFixes],
  });
  const module = {
    exports: {} as {
      sliceByColumn: (text: string, start: number, length: number) => string;
    },
  };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const sliced = module.exports.sliceByColumn("\x1b[7mA\x1b[0m B", 1, 2);
  assert.equal(sliced.replace(/\x1b\[[0-9;]*m/g, ""), " B");
  assert.ok(
    sliced.indexOf("\x1b[7m") < sliced.indexOf("\x1b[0m"),
    "the inverse reset must win at the boundary",
  );
});
