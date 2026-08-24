const OPENAI_DEVICE_HOSTS = new Set(["auth.openai.com"]);

export class ProviderOAuthSessions {
  readonly #controllers = new Map<string, AbortController>();

  begin(providerId: string): AbortController {
    if (this.#controllers.has(providerId))
      throw new Error("Account login is already in progress");
    const controller = new AbortController();
    this.#controllers.set(providerId, controller);
    return controller;
  }

  cancel(providerId: string): boolean {
    const controller = this.#controllers.get(providerId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  finish(providerId: string, controller: AbortController): void {
    if (this.#controllers.get(providerId) === controller)
      this.#controllers.delete(providerId);
  }
}

/** pi-ai wraps credential persistence failures in ModelsError. IPC does not
 * preserve Error.cause, so unwrap the useful inner message before the error
 * crosses into the renderer. */
export function providerOAuthError(reason: unknown): Error {
  let current: unknown = reason;
  let message = reason instanceof Error ? reason.message : String(reason ?? '');
  const visited = new Set<unknown>();
  while (current instanceof Error && current.cause && !visited.has(current.cause)) {
    visited.add(current);
    current = current.cause;
    if (current instanceof Error && current.message) message = current.message;
  }
  return new Error(message || 'ChatGPT account connection failed');
}

/**
 * Device-login links are dependency data crossing into the user's browser.
 * Keep that boundary pinned to OpenAI's HTTPS device page so a provider or
 * dependency change cannot turn sign-in into an arbitrary external launch.
 */
export function openAICodexDeviceUri(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || !OPENAI_DEVICE_HOSTS.has(url.hostname)
    || url.pathname !== "/codex/device"
    || url.username
    || url.password
  ) throw new Error("OpenAI returned an unexpected device-login address");
  return url.toString();
}

export function openAICodexInteraction(
  providerId: string,
  signal: AbortSignal,
  publish: (event: ProviderOAuthEventDto) => void,
): AuthInteraction {
  return {
    signal,
    prompt: async (prompt) => {
      if (prompt.type === "select") {
        const device = prompt.options.find((option) => option.id === "device_code");
        if (device) return device.id;
      }
      throw new Error("This account login requires an unsupported interactive prompt");
    },
    notify: (notice) => {
      if (notice.type === "device_code") publish({
        providerId,
        type: "device_code",
        userCode: notice.userCode,
        verificationUri: openAICodexDeviceUri(notice.verificationUri),
        ...(notice.expiresInSeconds ? {expiresInSeconds: notice.expiresInSeconds} : {}),
      });
      else if (notice.type === "progress") publish({
        providerId,
        type: "progress",
        message: notice.message,
      });
    },
  };
}
import type {AuthInteraction} from "@earendil-works/pi-ai";
import type {ProviderOAuthEventDto} from "@polymux/protocol";
