import type {SystemPermissionKind, SystemPermissionStatus} from "@flareai/protocol";

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
  microphoneEnabled: () => boolean;
  screenRecordingEnabled: () => boolean;
  status: (permission: SystemPermissionKind) => SystemPermissionStatus;
  request: (permission: SystemPermissionKind) => Promise<SystemPermissionStatus>;
  onReady: () => void;
}

const preferenceKey = "first-run-permissions-requested";

/** Requests only permissions for features that are enabled, in sequence, so
 * macOS never stacks native consent prompts on top of one another. */
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
      if (this.#options.microphoneEnabled())
        await this.#options.request("microphone");
      if (this.#options.screenRecordingEnabled())
        await this.#options.request("screen-recording");
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
