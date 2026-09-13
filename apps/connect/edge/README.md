# Polymux Connect edge

This small Vercel project keeps every public pairing and mobile request on
`connect.polymux.com` while reverse-proxying HTTPS requests to the durable
Cloudflare Worker. The Host reads `/connect-config` through that trusted
Polymux address, then opens its authenticated outbound WSS connection directly
to the Worker origin. End users do not create an account or install network
software, and no WebSocket depends on Vercel's HTTP-only external rewrite.

## Deployment

1. Deploy `apps/connect/relay` and copy the HTTPS `workers.dev` origin that Wrangler
   prints, without a trailing slash.
2. Create a separate Vercel project rooted at `apps/connect/edge`.
3. Set `POLYMUX_CONNECT_UPSTREAM` for Production to that origin:

   ```sh
   npx vercel@59.10.0 env add POLYMUX_CONNECT_UPSTREAM production \
     --value https://polymux-connect.<account>.workers.dev \
     --no-sensitive --yes --force
   ```

4. Deploy without changing the public domain, then verify the generated Vercel
   URL through Vercel's authenticated curl helper:

   ```sh
   npx vercel@59.10.0 deploy --prod --skip-domain --yes
   npx vercel@59.10.0 curl /healthz --deployment <deployment-url>
   ```

5. Only after that health check succeeds, register and assign the public
   hostname, then verify it independently. Registering the domain makes it a
   public production domain under Vercel Standard Protection; `alias set` alone
   leaves a manually assigned hostname behind Vercel login.

   ```sh
   npx vercel@59.10.0 domains add connect.polymux.com polymux-connect
   npx vercel@59.10.0 alias set <deployment-url> connect.polymux.com
   curl -f https://connect.polymux.com/healthz
   curl -f https://connect.polymux.com/connect-config
   npm run test:connect-live
   ```

   The live smoke test uses an isolated temporary Host, pairs through the public
   domain, calls authenticated RPC, restarts the Host, verifies saved-pairing
   reconnection, and removes its local test data.

Vercel resolves the upstream variable inside its routing layer for bounded HTTP
requests. External rewrites do not preserve a WebSocket upgrade, so the
discovery response deliberately points the Host at the Worker's WSS origin.
Keep the edge as a separate deployment from `apps/site` so a Connect deployment
cannot replace the public website and vice versa.

The isolated Vercel project was verified on 31 August 2026 with both HTTP and
WebSocket probes. HTTP reached the external origin with the upstream hostname
and URL, which confirms that the Worker's `/connect-config` response discovers
its direct `workers.dev` origin. A WebSocket upgrade became an ordinary upstream
GET and returned 404. The probe domains, deployments, aliases, and environment
values were removed afterward.
