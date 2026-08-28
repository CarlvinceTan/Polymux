import {
  BUILT_IN_PERMISSION_KINDS,
  type BuiltInPermissionKind,
  type SystemPermissionKind,
  type SystemPermissionStatus,
} from "@polymux/protocol";

export interface PermissionPreferenceStore {
  getPreference(key: string): {value: unknown} | null;
  setPreference(key: string, value: boolean): unknown;
}

export interface FirstRunPermissionResult {
  firstRun: boolean;
  microphone: SystemPermissionStatus;
  screenRecording: SystemPermissionStatus;
}

export interface FirstRunPermissionOptions {
  store: PermissionPreferenceStore;
  enabled: (permission: BuiltInPermissionKind) => boolean;
  status: (permission: SystemPermissionKind) => SystemPermissionStatus;
  request: (permission: BuiltInPermissionKind) => Promise<SystemPermissionStatus>;
  onReady: () => void;
}

// A new key deliberately gives installs which completed the old, silent flow
// one pass through the immediate request policy.
const preferenceKey = "first-run-permissions-requested-immediately";

/**
 * Immediately asks for every enabled built-in grant on the first app launch.
 * Requests are issued in sequence, with Full Disk Access last. macOS has no
 * grant dialog for that permission, so its request opens the exact Privacy &
 * Security pane instead.
 */
export class FirstRunPermissions {
  readonly #options: FirstRunPermissionOptions;
  #pending?: Promise<FirstRunPermissionResult>;

  constructor(options: FirstRunPermissionOptions) {
    this.#options = options;
  }

  completed(): boolean {
    return this.#options.store.getPreference(preferenceKey)?.value === true;
  }

  ensure(): Promise<FirstRunPermissionResult> {
    if (this.#pending) return this.#pending;
    this.#pending = this.#ensure().finally(() => this.#pending = undefined);
    return this.#pending;
  }

  async #ensure(): Promise<FirstRunPermissionResult> {
    const firstRun = !this.completed();
    if (firstRun) {
      for (const permission of BUILT_IN_PERMISSION_KINDS)
        if (this.#options.enabled(permission))
          await this.#options.request(permission);
      this.#options.store.setPreference(preferenceKey, true);
    }
    this.#options.onReady();
    return {
      firstRun,
      microphone: this.#options.status("microphone"),
      screenRecording: this.#options.status("screen-recording"),
    };
  }
}
