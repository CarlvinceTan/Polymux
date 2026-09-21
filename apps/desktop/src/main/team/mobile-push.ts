import {connect} from 'node:http2';
import {createPrivateKey, sign} from 'node:crypto';
import {readFileSync} from 'node:fs';

export interface MobilePushSubscription { token: string; environment: 'sandbox' | 'production' }
export function parseMobilePush(value: unknown): MobilePushSubscription | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.token !== 'string' || !/^[a-f0-9]{64,200}$/i.test(row.token)) return null;
  if (row.environment !== 'sandbox' && row.environment !== 'production') return null;
  return {token: row.token.toLowerCase(), environment: row.environment};
}
export function mobilePushAvailable(): boolean {
  return Boolean(process.env.POLYMUX_APNS_KEY_PATH && process.env.POLYMUX_APNS_KEY_ID && process.env.POLYMUX_APNS_TEAM_ID);
}

/** Server-side APNs credentials stay on the Host; the mobile receives no signing key. */
export async function sendMobilePush(subscription: MobilePushSubscription): Promise<'sent' | 'expired'> {
  const {POLYMUX_APNS_KEY_PATH: path, POLYMUX_APNS_KEY_ID: kid, POLYMUX_APNS_TEAM_ID: team} = process.env;
  if (!path || !kid || !team) throw new Error('Mobile notifications are not configured on this Host.');
  const header = Buffer.from(JSON.stringify({alg: 'ES256', kid})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({iss: team, iat: Math.floor(Date.now() / 1000)})).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(unsigned), {key: createPrivateKey(readFileSync(path)), dsaEncoding: 'ieee-p1363'}).toString('base64url');
  const origin = subscription.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  return new Promise((resolve, reject) => {
    const client = connect(origin);
    const timeout = setTimeout(() => { client.destroy(); reject(new Error('Apple notification delivery timed out.')); }, 10_000);
    const finish = (error?: Error, result: 'sent' | 'expired' = 'sent') => {
      clearTimeout(timeout); client.close();
      if (error) reject(error); else resolve(result);
    };
    client.once('error', () => finish(new Error('Apple notification service could not be reached.')));
    const request = client.request({
      ':method': 'POST', ':path': `/3/device/${subscription.token}`,
      authorization: `bearer ${unsigned}.${signature}`,
      'apns-topic': 'com.flarehq.polymux.mobile', 'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
    });
    let status = 0;
    let body = '';
    request.on('response', headers => { status = Number(headers[':status']); });
    request.on('data', chunk => { if (body.length < 4096) body += String(chunk); });
    request.once('error', () => finish(new Error('Apple notification delivery failed.')));
    request.on('end', () => {
      if (status === 200) finish();
      else if (status === 410 || status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(body)) finish(undefined, 'expired');
      else finish(new Error(`Apple rejected the notification (${status}).`));
    });
    request.end(JSON.stringify({aps: {alert: {title: 'Polymux', body: 'Your task has finished. Open Polymux to view the result.'}, sound: 'default'}}));
  });
}
