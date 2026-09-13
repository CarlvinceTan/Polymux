import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import {
  authCallback,
  openLoginUrl,
  type AccountRequest,
  type Status,
} from "../auth.js";

export interface LoginUI {
  signal: AbortSignal;
  pick(
    title: string,
    items: Array<{ value: string; label: string; description?: string }>,
  ): Promise<string | undefined>;
  prompt(
    title: string,
    secret?: boolean,
    signal?: AbortSignal,
  ): Promise<string | undefined>;
  notify(message: string): void;
}
async function browser(url: string, ui: LoginUI) {
  if (ui.signal.aborted) return;
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname)
    )
  )
    throw new Error("Invalid login URL.");
  ui.notify(
    `Open to sign in:\n${url}${process.env.SSH_CONNECTION ? "\nForward the callback port over SSH before signing in." : ""}`,
  );
  if (!process.env.SSH_CONNECTION && !process.env.SSH_TTY)
    await openLoginUrl(url).catch(() => {});
}
export async function login(
  request: AccountRequest,
  ui: LoginUI,
  name?: string,
): Promise<string> {
  const providers = builtinProviders();
  const selected =
    name ||
    (await ui.pick("Login", [
      {
        value: "polymux",
        label: "Polymux account",
        description: "Google, Apple, or email · link your devices",
      },
      ...providers
        .filter(
          (provider) => provider.auth.oauth || provider.auth.apiKey?.login,
        )
        .map((provider) => ({
          value: provider.id,
          label: provider.name || provider.id,
          description: "Model provider",
        })),
    ]));
  if (!selected) return "";
  if (["polymux", "apple", "email"].includes(selected)) {
    const current = await request<Status>({ action: "status" });
    if (current.signedIn)
      return `Signed in as ${current.profile?.email || "Polymux account"}`;
    if (!current.available)
      throw new Error("Configure Supabase for the Host before signing in.");
    const provider =
      selected === "polymux"
        ? await ui.pick(
            "Polymux account",
            ["google", "apple", "email"].map((value) => ({
              value,
              label:
                value === "email"
                  ? "Email and password"
                  : value === "google"
                    ? "Google"
                    : "Apple",
            })),
          )
        : selected;
    if (!provider) return "";
    let result: Status;
    if (provider === "email") {
      const email = await ui.prompt("Email");
      if (!email) return "";
      const password = await ui.prompt("Password", true);
      if (!password) return "";
      result = await request<Status>({
        action: "login",
        provider,
        email,
        password,
      });
    } else {
      const callback = await authCallback(ui.signal);
      let id: string | undefined;
      try {
        const started = await request<{ id: string; url: string }>({
          action: "login",
          provider,
        });
        id = started.id;
        if (ui.signal.aborted) throw new Error("Sign-in cancelled.");
        await browser(started.url, ui);
        const code = await callback.code;
        result = await request<Status>({ action: "complete", id, code });
        id = undefined;
      } finally {
        callback.close();
        if (id) await request({ action: "cancel", id }).catch(() => {});
      }
    }
    return `Signed in as ${result.profile?.email || "Polymux account"}${result.device.error ? ` · Device linking: ${result.device.error}` : " · Device linking enabled"}`;
  }
  const provider = providers.find((provider) => provider.id === selected);
  if (!provider) throw new Error(`Unknown provider: ${selected}`);
  const methods = [
    ...(provider.auth.oauth
      ? [{ value: "oauth", label: provider.auth.oauth.name }]
      : []),
    ...(provider.auth.apiKey?.login
      ? [{ value: "apiKey", label: provider.auth.apiKey.name }]
      : []),
  ];
  const method =
    methods.length === 1
      ? methods[0].value
      : await ui.pick(provider.name, methods);
  if (!method) return "";
  const auth = method === "oauth" ? provider.auth.oauth : provider.auth.apiKey;
  if (!auth?.login)
    throw new Error("This provider uses credentials configured on the Host.");
  const credential = await auth.login({
    signal: ui.signal,
    async prompt(prompt: AuthPrompt) {
      const value =
        prompt.type === "select"
          ? await ui.pick(
              prompt.message,
              prompt.options.map((option) => ({
                value: option.id,
                label: option.label,
                description: option.description,
              })),
            )
          : await ui.prompt(
              prompt.message,
              prompt.type === "secret" || prompt.type === "manual_code",
              prompt.signal,
            );
      if (value === undefined) throw new Error("Sign-in cancelled.");
      return value;
    },
    notify(event: AuthEvent) {
      if (event.type === "auth_url")
        void browser(event.url, ui).catch((error) => ui.notify(String(error)));
      else if (event.type === "device_code")
        ui.notify(`${event.verificationUri}\nCode: ${event.userCode}`);
      else
        ui.notify(
          event.message +
            (event.type === "info"
              ? (event.links ?? []).map((link) => `\n${link.url}`).join("")
              : ""),
        );
    },
  });
  if (ui.signal.aborted) throw new Error("Sign-in cancelled.");
  await request({
    action: "provider.save",
    provider: provider.id,
    credential: credential as any,
  });
  return `Signed in to ${provider.name}`;
}
