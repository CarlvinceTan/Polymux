import {existsSync} from "node:fs";
import path from "node:path";

/** A checkout must execute its reviewed source, even after a package build
 * has left an older copied runtime in resources/. Packaged apps use only
 * their shipped runtime; neither mode silently crosses that boundary. */
export function weChatRuntimeFile(
  name: string,
  options: {development: boolean; sourceDirectory: string; bundledDirectory: string},
): string | undefined {
  const candidate = path.join(
    options.development ? options.sourceDirectory : options.bundledDirectory,
    name,
  );
  return existsSync(candidate) ? candidate : undefined;
}

/** Keyed, read-only imports are ordinary startup behavior. Keep an explicit
 * opt-out for diagnosing the relay; missing or ambiguous accounts remain
 * rejected by the bridge independently of this preference. */
export function weChatNativeInboundEnabled(environment: NodeJS.ProcessEnv): boolean {
  return environment.POLYMUX_WECHAT_NATIVE_INBOUND !== "0";
}

/** WeChat's registry, relay and desktop process live outside Polymux's data
 * directory. A named isolate must explicitly opt into that real account;
 * changing the inbound transport or registry path does not isolate it. */
export function weChatExternalAccessEnabled(environment: NodeJS.ProcessEnv): boolean {
  return !environment.POLYMUX_DEV_INSTANCE?.trim() ||
    environment.POLYMUX_WECHAT_ISOLATE_LIVE === "1";
}
