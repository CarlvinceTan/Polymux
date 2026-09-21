#!/usr/bin/env node
/** Assemble the complete target-native no-Xcode iPhone signing runtime. */

import {buildMobileIosSigner} from "./build-mobile-ios-signer.mjs";
import {buildMobileZsign} from "./build-mobile-zsign.mjs";

if (process.platform === "darwin") await buildMobileZsign();
await buildMobileIosSigner();
