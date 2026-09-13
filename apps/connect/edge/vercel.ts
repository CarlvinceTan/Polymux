/**
 * Keep the user-facing relay on the Polymux domain while Vercel owns DNS.
 * The named variable is resolved by Vercel's routing layer and must be the HTTPS
 * workers.dev origin printed by the Polymux Connect Worker deployment.
 */
export const config = {
  framework: null,
  rewrites: [
    {
      source: "/(.*)",
      destination: "$POLYMUX_CONNECT_UPSTREAM/$1",
      env: ["POLYMUX_CONNECT_UPSTREAM"],
    },
  ],
} as const;
