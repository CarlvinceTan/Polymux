import {config} from "../vercel.ts";

const [rewrite] = config.rewrites ?? [];
if (
  config.framework !== null ||
  config.rewrites?.length !== 1 ||
  !rewrite ||
  !("source" in rewrite) ||
  rewrite.source !== "/(.*)" ||
  !("destination" in rewrite) ||
  rewrite.destination !== "$POLYMUX_CONNECT_UPSTREAM/$1" ||
  !("env" in rewrite) ||
  rewrite.env?.length !== 1 ||
  rewrite.env[0] !== "POLYMUX_CONNECT_UPSTREAM"
) {
  throw new Error("The Polymux Connect Vercel rewrite is not configured correctly.");
}

console.log("Polymux Connect Vercel rewrite is valid.");
