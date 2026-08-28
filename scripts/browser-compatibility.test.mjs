import assert from "node:assert/strict";
import test from "node:test";
import {
  compareStoreVersions,
  publishedExtension,
  requirePublishedCompatibility,
} from "./browser-compatibility.mjs";

function status(version, deployPercentage = 100) {
  return {
    publishedItemRevisionStatus: {
      distributionChannels: [{crxVersion: version, deployPercentage}],
    },
  };
}

test("Chrome extension versions compare independently from desktop semver", () => {
  assert.ok(compareStoreVersions("0.2.2", "0.2.1") > 0);
  assert.equal(compareStoreVersions("1.2", "1.2.0.0"), 0);
});

test("the highest published Store channel is selected", () => {
  const value = status("0.2.1");
  value.publishedItemRevisionStatus.distributionChannels.push({
    crxVersion: "0.3.0",
    deployPercentage: 100,
  });
  assert.equal(publishedExtension(value).version, "0.3.0");
});

test("a published compatible extension satisfies the desktop gate", () => {
  assert.equal(
    requirePublishedCompatibility(status("0.2.2"), "0.2.1").version,
    "0.2.2",
  );
});

test("an older or partially deployed extension blocks desktop publication", () => {
  assert.throws(
    () => requirePublishedCompatibility(status("0.2.0"), "0.2.1"),
    /requires extension 0.2.1.*Store publishes 0.2.0/,
  );
  assert.throws(
    () => requirePublishedCompatibility(status("0.2.1", 50), "0.2.1"),
    /only 50%/,
  );
  assert.throws(
    () => requirePublishedCompatibility({
      publishedItemRevisionStatus: {
        distributionChannels: [{crxVersion: "0.2.1"}],
      },
    }, "0.2.1"),
    /missing its deployment percentage/,
  );
});
