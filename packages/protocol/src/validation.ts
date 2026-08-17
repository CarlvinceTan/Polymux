import type {
  CommsEmailPreset,
  CommsPlatform,
  CommsSetupFieldDto,
  DriveProviderId,
  DriveProviderKind,
  DriveS3ConfigRequest,
  GoalCommandRequest,
  ReasoningEffort,
  SaveEmailAccountRequest,
  StartRunRequest,
  SystemPermissionKind,
} from "./types.js";

/**
 * Whether macOS raises its own dialog for a grant. Full Disk Access does not:
 * it is switched on by hand in System Settings, so asking for it can only mean
 * opening the pane it lives in. Every button that offers a permission needs to
 * know which of the two it is doing, so they all read it from here.
 */
export function permissionPrompts(kind: SystemPermissionKind): boolean {
  return kind !== "full-disk-access";
}

const REASONING_EFFORTS: ReasoningEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Model servers that run on the user's own machine. They all speak the
 * OpenAI Chat Completions API, so a runtime is nothing but the port it listens
 * on — which is why FlareAI can offer them as ready-made providers rather than
 * as a custom endpoint the user has to describe. They are listed alongside the
 * hosted providers everywhere providers are listed; setting one up asks it what
 * models it has rather than asking the user. */
export const LOCAL_RUNTIMES: ReadonlyArray<{
  id: string;
  name: string;
  baseUrl: string;
}> = [
  { id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "lm-studio", name: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { id: "vllm", name: "vLLM", baseUrl: "http://localhost:8000/v1" },
  { id: "llama-cpp", name: "llama.cpp", baseUrl: "http://localhost:8080/v1" },
];

/** The interface languages offered in Settings → General. Every entry here has
 * a message catalog under `src/renderer/lib/i18n/messages`, so the list is
 * exactly what FlareAI is translated into — not every BCP 47 tag Intl would
 * accept. `system` follows the host locale, falling back to English when it
 * names a language with no catalog. Labels are written in the language itself,
 * so the menu reads the same whatever locale is currently active. */
export const SUPPORTED_LANGUAGES: {value: string; label: string}[] = [
  { value: "system", label: "System" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "nl", label: "Nederlands" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "hi", label: "हिन्दी" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "ms", label: "Bahasa Melayu" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "ar", label: "العربية" },
  { value: "ru", label: "Русский" },
];

export function supportedLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return SUPPORTED_LANGUAGES.some((item) => item.value === value) ? value : null;
}

/**
 * Every platform the Communications tab lists, in display order. `route` is
 * the path segment the hub proxies a bridge's provisioning API under; a null
 * route means the bridge has no remote account to link — it either runs
 * against a local relay (iMessage, WeChat) or is the hub account itself.
 */
export const COMMS_PLATFORMS: {
  value: CommsPlatform;
  label: string;
  route: string | null;
  /** Bridge bot localpart, used to find the management room. */
  bot: string | null;
  /** Values the bridge needs before it will run at all. */
  setup?: CommsSetupFieldDto[];
}[] = [
  { value: "whatsapp", label: "WhatsApp", route: "whatsapp", bot: "whatsappbot" },
  {
    value: "telegram",
    label: "Telegram",
    route: "telegram",
    bot: "telegrambot",
    // Telegram refuses to connect without an application of its own, and the
    // pair is bound to whoever registered it. A build that ships one of its
    // own satisfies this without asking (see `shipped-credentials.ts`), and
    // these fields are what a build without one falls back to — along with the
    // way any user overrides the shipped pair with their own.
    setup: [
      {
        id: "api_id",
        name: "API ID",
        description: "The numeric ID of your Telegram application.",
        helpUrl: "https://my.telegram.org/apps",
        secret: false,
      },
      {
        id: "api_hash",
        name: "API hash",
        description: "The hash shown next to it.",
        helpUrl: "https://my.telegram.org/apps",
        secret: true,
      },
    ],
  },
  { value: "signal", label: "Signal", route: "signal", bot: "signalbot" },
  { value: "messenger", label: "Messenger", route: "messenger", bot: "messengerbot" },
  { value: "instagram", label: "Instagram", route: "instagram", bot: "instagrambot" },
  { value: "discord", label: "Discord", route: "discord", bot: "discordbot" },
  { value: "slack", label: "Slack", route: "slack", bot: "slackbot" },
  { value: "linkedin", label: "LinkedIn", route: "linkedin", bot: "linkedinbot" },
  { value: "googlechat", label: "Google Chat", route: "googlechat", bot: "googlechatbot" },
  { value: "gmessages", label: "Google Messages", route: "gmessages", bot: "gmessagesbot" },
  { value: "twitter", label: "X", route: "twitter", bot: "twitterbot" },
  { value: "bluesky", label: "Bluesky", route: "bluesky", bot: "blueskybot" },
  { value: "gvoice", label: "Google Voice", route: "gvoice", bot: "gvoicebot" },
  { value: "zulip", label: "Zulip", route: "zulip", bot: "zulipbot" },
  { value: "imessage", label: "iMessage", route: "imessage", bot: "imessagebot" },
  // No mautrix bridge exists for WeChat, so there is nothing to route to. It
  // stays listed because the hub is where it would arrive if one appears.
  { value: "wechat", label: "WeChat", route: null, bot: "wechatbot" },
  { value: "matrix", label: "Matrix", route: null, bot: null },
];

export function commsPlatform(value: unknown): CommsPlatform {
  if (
    typeof value !== "string" ||
    !COMMS_PLATFORMS.some((item) => item.value === value)
  )
    throw new Error(`${String(value)} is not a supported messaging platform`);
  return value as CommsPlatform;
}

export function commsPlatformLabel(value: CommsPlatform): string {
  return COMMS_PLATFORMS.find((item) => item.value === value)?.label ?? value;
}

/**
 * Every storage backend the drive knows about, in the order the settings tab
 * lists them. Main and renderer both read names and kinds from here so a new
 * provider is one entry rather than a string duplicated across layers.
 */
export const DRIVE_PROVIDERS: {
  value: DriveProviderId;
  label: string;
  kind: DriveProviderKind;
  /** One line under the name in Settings → Drive. */
  description: string;
}[] = [
  {
    value: "local",
    label: "This Mac",
    kind: "local",
    description: "A folder on this computer. Always available, never synced.",
  },
  {
    value: "google-drive",
    label: "Google Drive",
    kind: "oauth",
    description: "Files FlareAI creates live in their own Drive folder.",
  },
  {
    value: "dropbox",
    label: "Dropbox",
    kind: "oauth",
    description: "Scoped to the FlareAI app folder, not your whole Dropbox.",
  },
  {
    value: "onedrive",
    label: "OneDrive",
    kind: "oauth",
    description: "Personal or work account, in its own FlareAI folder.",
  },
  {
    value: "s3",
    label: "S3 storage",
    kind: "s3",
    description: "Any S3-compatible bucket — AWS, R2, Backblaze, or MinIO.",
  },
];

export function driveProvider(value: unknown): DriveProviderId {
  if (
    typeof value !== "string" ||
    !DRIVE_PROVIDERS.some((item) => item.value === value)
  )
    throw new Error(`${String(value)} is not a supported storage provider`);
  return value as DriveProviderId;
}

/**
 * The two folders the local provider always offers, independent of any account
 * the user connects.
 *
 * These live here rather than beside the drive types because `types.ts` carries
 * no runtime values: a module of pure types is erased at transpile, and an
 * exported constant sitting in it is missing by the time the renderer imports
 * it.
 */
export const DRIVE_LOCAL_OUTPUTS = "outputs";
export const DRIVE_LOCAL_HOME = "home";

/** Builds a source id, and takes one apart again. Kept in one place so the
 * renderer and the main process cannot disagree about the separator. */
export function driveSourceId(
  provider: DriveProviderId,
  accountId: string,
): string {
  return `${provider}#${accountId}`;
}

export function parseDriveSourceId(
  id: string,
): {provider: DriveProviderId; accountId: string} {
  const hash = id.indexOf("#");
  // A bare provider id is what older preferences and the save order hold, and
  // it means the provider's first account.
  if (hash < 0) return {provider: id as DriveProviderId, accountId: ""};
  return {
    provider: id.slice(0, hash) as DriveProviderId,
    accountId: id.slice(hash + 1),
  };
}

/**
 * Checks a source id — `<provider>#<accountId>`, or a bare provider id meaning
 * that provider's first account. The account half is only checked for shape:
 * which accounts exist is the drive's business, and it answers with a clear
 * error of its own for one it does not hold.
 */
export function driveSource(value: unknown): string {
  if (typeof value !== "string" || value === "")
    throw new Error(`${String(value)} is not a storage location`);
  const hash = value.indexOf("#");
  driveProvider(hash < 0 ? value : value.slice(0, hash));
  return value;
}

export function driveProviderLabel(value: DriveProviderId): string {
  return DRIVE_PROVIDERS.find((item) => item.value === value)?.label ?? value;
}

export function driveProviderKind(value: DriveProviderId): DriveProviderKind {
  return DRIVE_PROVIDERS.find((item) => item.value === value)?.kind ?? "oauth";
}

/** Unknown ids are dropped rather than rejected: an order persisted by a build
 * that knew a provider this one does not must still load. */
export function driveSaveOrder(value: unknown): DriveProviderId[] {
  if (!Array.isArray(value)) return DRIVE_PROVIDERS.map((item) => item.value);
  const seen = new Set<DriveProviderId>();
  for (const entry of value)
    if (
      typeof entry === "string" &&
      DRIVE_PROVIDERS.some((item) => item.value === entry)
    )
      seen.add(entry as DriveProviderId);
  // Anything the stored order left out still has to be reachable, so the
  // catalogue's own order fills the tail.
  for (const item of DRIVE_PROVIDERS) seen.add(item.value);
  return [...seen];
}

export function driveS3Config(value: unknown): DriveS3ConfigRequest {
  if (typeof value !== "object" || value === null)
    throw new Error("S3 settings are required");
  const record = value as Record<string, unknown>;
  const text = (key: string, label: string): string => {
    const entry = record[key];
    if (typeof entry !== "string" || !entry.trim())
      throw new Error(`${label} is required`);
    return entry.trim();
  };
  const optional = (key: string): string | null => {
    const entry = record[key];
    return typeof entry === "string" && entry.trim() ? entry.trim() : null;
  };
  const secret = record.secretAccessKey;
  return {
    bucket: text("bucket", "Bucket"),
    region: text("region", "Region"),
    endpoint: optional("endpoint"),
    accessKeyId: text("accessKeyId", "Access key ID"),
    secretAccessKey:
      typeof secret === "string" && secret ? secret : undefined,
    prefix: optional("prefix"),
    forcePathStyle: record.forcePathStyle === true,
  };
}

/** Server settings the account form fills in once a provider is picked. */
export const COMMS_EMAIL_PRESETS: {
  value: CommsEmailPreset;
  label: string;
  imapHost: string;
  imapPort: number;
  imapEncryption: "tls" | "start-tls" | "none";
  smtpHost: string;
  smtpPort: number;
  smtpEncryption: "tls" | "start-tls" | "none";
  /** What to tell the user about credentials for this provider. */
  hint: string;
}[] = [
  {
    value: "gmail",
    label: "Gmail / Google Workspace",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapEncryption: "tls",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpEncryption: "start-tls",
    hint: "Needs a 16-character app password from your Google account, not your login password.",
  },
  {
    value: "outlook",
    label: "Outlook / Microsoft 365",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapEncryption: "tls",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpEncryption: "start-tls",
    hint: "Tenants with security defaults on require an OAuth token command rather than a password.",
  },
  {
    value: "icloud",
    label: "iCloud Mail",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapEncryption: "tls",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpEncryption: "start-tls",
    hint: "Needs an app-specific password from appleid.apple.com.",
  },
  {
    value: "lark",
    label: "Lark / Feishu",
    imapHost: "imap.larksuite.com",
    imapPort: 993,
    imapEncryption: "tls",
    smtpHost: "smtp.larksuite.com",
    smtpPort: 465,
    smtpEncryption: "tls",
    // Lark's 587 listener does not complete STARTTLS; 465 with implicit TLS
    // is the only combination that authenticates.
    hint: "Use the mail password from Lark's mail settings, and keep SMTP on 465.",
  },
  {
    value: "fastmail",
    label: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    imapEncryption: "tls",
    smtpHost: "smtp.fastmail.com",
    smtpPort: 465,
    smtpEncryption: "tls",
    hint: "Needs an app password scoped to mail.",
  },
  {
    value: "custom",
    label: "Other (IMAP/SMTP)",
    imapHost: "",
    imapPort: 993,
    imapEncryption: "tls",
    smtpHost: "",
    smtpPort: 587,
    smtpEncryption: "start-tls",
    hint: "Enter the server names your provider documents for IMAP and SMTP.",
  },
];

export function validateSaveEmailAccount(value: unknown): SaveEmailAccountRequest {
  const input = record(value, "email account");
  const id = text(input.id, "id");
  // The id becomes a TOML table key and a `himalaya -a <id>` argument, so keep
  // it to something neither of those has to quote or escape.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id))
    throw new Error("Account name may only contain letters, numbers, dashes, and underscores");
  const email = text(input.email, "email");
  if (!email.includes("@")) throw new Error("email must be an address");
  const preset = text(input.preset, "preset");
  if (!COMMS_EMAIL_PRESETS.some((item) => item.value === preset))
    throw new Error(`${preset} is not a supported email provider`);
  return {
    originalId:
      input.originalId === undefined ? undefined : text(input.originalId, "originalId"),
    id,
    displayName:
      input.displayName === undefined || input.displayName === ""
        ? undefined
        : text(input.displayName, "displayName"),
    email,
    preset: preset as CommsEmailPreset,
    imapHost: text(input.imapHost, "imapHost"),
    imapPort: port(input.imapPort, "imapPort"),
    imapEncryption: encryption(input.imapEncryption, "imapEncryption"),
    imapLogin:
      input.imapLogin === undefined || input.imapLogin === ""
        ? undefined
        : text(input.imapLogin, "imapLogin"),
    smtpHost: text(input.smtpHost, "smtpHost"),
    smtpPort: port(input.smtpPort, "smtpPort"),
    smtpEncryption: encryption(input.smtpEncryption, "smtpEncryption"),
    smtpLogin:
      input.smtpLogin === undefined || input.smtpLogin === ""
        ? undefined
        : text(input.smtpLogin, "smtpLogin"),
    password:
      input.password === undefined || input.password === ""
        ? undefined
        : text(input.password, "password"),
    tokenCommand:
      input.tokenCommand === undefined || input.tokenCommand === ""
        ? undefined
        : text(input.tokenCommand, "tokenCommand"),
    isDefault:
      input.isDefault === undefined ? undefined : boolean(input.isDefault, "isDefault"),
  };
}

export function validateStartRun(value: unknown): StartRunRequest {
  const input = record(value, "start run");
  return {
    conversationId: text(input.conversationId, "conversationId"),
    text: text(input.text, "text"),
    messageId:
      input.messageId === undefined
        ? undefined
        : text(input.messageId, "messageId"),
    attachments:
      input.attachments === undefined
        ? undefined
        : stringArray(input.attachments, "attachments"),
    asGoal:
      input.asGoal === undefined ? undefined : boolean(input.asGoal, "asGoal"),
    reasoning:
      input.reasoning === undefined
        ? undefined
        : reasoningEffort(input.reasoning),
    speechMode:
      input.speechMode === undefined
        ? undefined
        : boolean(input.speechMode, "speechMode"),
  };
}

export function validateGoalCommand(value: unknown): GoalCommandRequest {
  const input = record(value, "goal command");
  const action = text(input.action, "action");
  if (
    !["view", "create", "update", "pause", "resume", "clear"].includes(action)
  )
    throw new Error("Invalid goal action");
  const objective =
    input.objective === undefined
      ? undefined
      : text(input.objective, "objective");
  if ((action === "create" || action === "update") && !objective?.trim())
    throw new Error("Goal objective is required");
  return {
    conversationId: text(input.conversationId, "conversationId"),
    action: action as GoalCommandRequest["action"],
    objective,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value;
}
function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`${label} must be an array of strings`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
function port(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${label} must be a port number`);
  return value;
}
function encryption(value: unknown, label: string): "tls" | "start-tls" | "none" {
  if (value !== "tls" && value !== "start-tls" && value !== "none")
    throw new Error(`${label} must be tls, start-tls, or none`);
  return value;
}
function reasoningEffort(value: unknown): ReasoningEffort {
  if (
    typeof value !== "string" ||
    !REASONING_EFFORTS.includes(value as ReasoningEffort)
  )
    throw new Error(`${value} is not a supported reasoning effort`);
  return value as ReasoningEffort;
}
