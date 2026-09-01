#!/usr/bin/env node
/** Assemble the complete target-native no-Xcode iPhone signing runtime. */

import {buildPhoneIosSigner} from "./build-phone-ios-signer.mjs";
import {buildPhoneZsign} from "./build-phone-zsign.mjs";

if (process.platform === "darwin") await buildPhoneZsign();
await buildPhoneIosSigner();
