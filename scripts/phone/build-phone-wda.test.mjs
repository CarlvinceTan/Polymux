import assert from "node:assert/strict";
import test from "node:test";
import {
  patchWdaScreenshotEncoding,
  WDA_BUNDLE_ID,
  WDA_PATCH_LEVEL,
  WDA_RELEASE,
  wdaBuildArguments,
} from "./build-phone-wda.mjs";

test("builds one unsigned generic-device WDA for local user signing", () => {
  assert.equal(WDA_RELEASE, "16.11.4");
  const args = wdaBuildArguments("/source", "/derived");
  assert.deepEqual(args.slice(0, 4), ["-project", "/source/WebDriverAgent.xcodeproj", "-scheme", "WebDriverAgentRunner"]);
  assert.ok(args.includes("CODE_SIGNING_ALLOWED=NO"));
  assert.ok(args.includes("CODE_SIGNING_REQUIRED=NO"));
  assert.ok(args.includes(`PRODUCT_BUNDLE_IDENTIFIER=${WDA_BUNDLE_ID}`));
  assert.equal(args.at(-1), "build-for-testing");
  assert.equal(WDA_PATCH_LEVEL, 1);
});

test("preserves WDA's requested JPEG encoding instead of re-encoding PNG", () => {
  const source = `return [[[FBImageProcessor alloc] init] scaledImageWithData:screenshotData
                                                          uti:UTTypePNG
                                                scalingFactor:1.0 / scale
                                           compressionQuality:FBMaxCompressionQuality
                                                        error:error];`;
  const patched = patchWdaScreenshotEncoding(source);
  assert.match(patched, /uti:uti/);
  assert.match(patched, /compressionQuality:compressionQuality/);
  assert.doesNotMatch(patched, /UTTypePNG|FBMaxCompressionQuality/);
  assert.throws(() => patchWdaScreenshotEncoding(patched), /no longer matches/i);
});
