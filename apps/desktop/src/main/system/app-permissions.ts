import type { AppPermissionKind, SystemPermissionStatus } from "@polymux/protocol";
import { permissionUsagePlist } from "./permission-usage.js";
import { SwiftHelper } from "./swift-helper.js";

const STATUSES = new Set<SystemPermissionStatus>([
  "not-determined",
  "granted",
  "denied",
  "restricted",
  "unknown",
]);

export interface AppPermissionsOptions {
  /** Path to native/app-permissions.swift (bundled with the app). */
  sourcePath: string;
  /** Writable directory for the compiled helper, e.g. `<userData>/bin`. */
  cacheDirectory: string;
}

/**
 * The grants Electron cannot reach: Reminders, Calendars, Contacts, Photos and
 * permission to drive another application. Each one is asked for by touching
 * the framework that owns it, which only a native helper can do.
 */
export class AppPermissions {
  readonly #helper: SwiftHelper;

  constructor(options: AppPermissionsOptions) {
    this.#helper = new SwiftHelper({
      name: "app-permissions",
      sourcePath: options.sourcePath,
      cacheDirectory: options.cacheDirectory,
      infoPlist: permissionUsagePlist(),
    });
  }

  status(
    permission: AppPermissionKind,
    target?: string,
  ): Promise<SystemPermissionStatus> {
    return this.#run("status", permission, target, 10_000);
  }

  /**
   * Raises the OS prompt when the grant has never been decided, and otherwise
   * reports what was decided before — macOS shows a prompt once and never
   * again, so a denied grant is changed in System Settings rather than here.
   *
   * The timeout is generous because the dialog waits on a person, and a run
   * that asked and got no answer is worth waiting out rather than reporting as
   * a failure.
   */
  request(
    permission: AppPermissionKind,
    target?: string,
  ): Promise<SystemPermissionStatus> {
    return this.#run("request", permission, target, 300_000);
  }

  async #run(
    action: "status" | "request",
    permission: AppPermissionKind,
    target: string | undefined,
    timeout: number,
  ): Promise<SystemPermissionStatus> {
    if (process.platform !== "darwin") return "granted";
    try {
      const line = await this.#helper.run(
        [action, permission, ...(target ? [target] : [])],
        timeout,
      );
      const status = (JSON.parse(line) as { status?: string }).status;
      return status && STATUSES.has(status as SystemPermissionStatus)
        ? (status as SystemPermissionStatus)
        : "unknown";
    } catch {
      // A helper that will not build or will not run says nothing about the
      // grant, and "unknown" is what the UI already knows how to offer
      // System Settings for.
      return "unknown";
    }
  }
}
