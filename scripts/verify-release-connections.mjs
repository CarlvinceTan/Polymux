const required = [
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

console.log("Release application registrations are present.");
