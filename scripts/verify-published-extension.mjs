#!/usr/bin/env node

import {SURFACE_PROTOCOL} from "../packages/browser/src/protocol.js";
import {requirePublishedCompatibility} from "./browser-compatibility.mjs";

const {ACCESS_TOKEN, CWS_EXTENSION_ID, CWS_PUBLISHER_ID} = process.env;
if (!ACCESS_TOKEN || !CWS_EXTENSION_ID || !CWS_PUBLISHER_ID)
  throw new Error(
    "ACCESS_TOKEN, CWS_EXTENSION_ID, and CWS_PUBLISHER_ID are required.",
  );

const response = await fetch(
  `https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:fetchStatus`,
  {headers: {Authorization: `Bearer ${ACCESS_TOKEN}`}},
);
if (!response.ok)
  throw new Error(
    `Chrome Web Store status returned ${response.status}: ${await response.text()}`,
  );
const published = requirePublishedCompatibility(
  await response.json(),
  SURFACE_PROTOCOL.minimumPublishedExtension.version,
);
console.log(
  `Chrome Web Store extension ${published.version} satisfies desktop minimum ${SURFACE_PROTOCOL.minimumPublishedExtension.version}.`,
);
