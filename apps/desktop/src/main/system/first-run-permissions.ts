import type {SystemPermissionKind, SystemPermissionStatus} from "@polymux/protocol";

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
  status: (permission: SystemPermissionKind) => SystemPermissionStatus;
  onReady: () => void;
}

const preferenceKey = "first-run-permissions-requested";

/**
 * Marks first run as done and starts what waits on it. It asks macOS for
 * nothing, and that is the whole point: this runs at launch, and a consent
 * dialog nobody pressed anything to get — arriving before there is a window to
 * explain it — is the surest way to a permanent "Don't Allow". The grants are
 * asked for where a person is looking at a reason: the onboarding permissions
 * step, the button on each row in Settings, or the moment something needs one.
 *
 * The statuses are still reported, because what a caller wants to know here is
 * what it may do, not what it just asked for.
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
    if (firstRun) this.#options.store.setPreference(preferenceKey, true);
    this.#options.onReady();
    return {
      firstRun,
      microphone: this.#options.status("microphone"),
      screenRecording: this.#options.status("screen-recording"),
    };
  }
}
