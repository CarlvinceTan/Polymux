const required = [
  "POLYMUX_SUPABASE_URL",
  "POLYMUX_SUPABASE_ANON_KEY",
  "POLYMUX_TELEGRAM_API_ID",
  "POLYMUX_TELEGRAM_API_HASH",
  "POLYMUX_GOOGLE_DRIVE_CLIENT_ID",
  "POLYMUX_DROPBOX_CLIENT_ID",
  "POLYMUX_ONEDRIVE_CLIENT_ID",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(
    `The release would disable built-in account connections. Missing: ${missing.join(", ")}`,
  );
  process.exit(1);
}

const anonKey = process.env.POLYMUX_SUPABASE_ANON_KEY?.trim() ?? "";
if (anonKey.startsWith("sb_secret_")) {
  console.error(
    "POLYMUX_SUPABASE_ANON_KEY must be the publishable key, not a server-only sb_secret_ key. " +
      "A secret key bypasses row-level security and would be inlined into shipped artifacts.",
  );
  process.exit(1);
}

console.log("Release application registrations are present.");
