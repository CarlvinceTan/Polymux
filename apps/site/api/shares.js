import {randomBytes, createHash} from 'node:crypto';
import {conversationSnapshot, MAX_SNAPSHOT_BYTES, SHARE_TTL_SECONDS} from '../lib/conversation-snapshot.js';

// Redis TTL removes the snapshot; the read-time deadline also fails closed.
export function createShareHandler({command, now = Date.now, token = () => randomBytes(24).toString('base64url')} = {}) {
  const redis = command ?? (async (...args) => {
    const url = process.env.SHARES_REDIS_REST_URL;
    const key = process.env.SHARES_REDIS_REST_TOKEN;
    if (!url || !key) throw new Error('Share storage unavailable');
    const result = await fetch(url, {method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(args), signal: AbortSignal.timeout(10000)});
    if (!result.ok) throw new Error('Share storage unavailable');
    const data = await result.json();
    if (data.error) throw new Error('Share storage unavailable');
    return data.result;
  });
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(204).end();
    if (!['GET', 'POST'].includes(request.method)) return response.status(405).json({error: 'Method not allowed'});
    try {
      if (request.method === 'GET') {
        const id = request.query?.id;
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(id)) return response.status(404).json({error: 'Not found or expired'});
        const raw = await redis('GET', `share:${id}`);
        const snapshot = raw ? JSON.parse(raw) : null;
        if (!snapshot || snapshot.expiresAt <= now()) return response.status(404).json({error: 'Not found or expired'});
        return response.status(200).json(snapshot);
      }
      if (Number(request.headers['content-length']) > MAX_SNAPSHOT_BYTES) return response.status(413).json({error: 'Conversation is too large to share'});
      let snapshot;
      try { snapshot = conversationSnapshot(typeof request.body === 'string' ? JSON.parse(request.body) : request.body); }
      catch (error) { return response.status(400).json({error: error.message}); }
      // A bounded creation budget per trusted Vercel client IP, with atomic expiry.
      const ip = request.headers['x-vercel-forwarded-for'] || request.socket?.remoteAddress || 'unknown';
      const bucket = createHash('sha256').update(String(ip)).digest('hex');
      const count = await redis('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],86400) end; return n", 1, `share-rate:${bucket}`);
      if (count > 30) return response.status(429).json({error: 'Daily share limit reached. Try again tomorrow.'});
      const id = token();
      const expiresAt = now() + SHARE_TTL_SECONDS * 1000;
      const saved = await redis('SET', `share:${id}`, JSON.stringify({...snapshot, expiresAt}), 'EX', SHARE_TTL_SECONDS, 'NX');
      if (saved !== 'OK') throw new Error('Share could not be saved');
      return response.status(201).json({url: `https://polymux.com/share/${id}`, expiresAt});
    } catch {
      return response.status(503).json({error: 'Sharing is temporarily unavailable. Please try again.'});
    }
  };
}
export default createShareHandler();
