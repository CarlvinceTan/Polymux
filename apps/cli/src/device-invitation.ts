export function parseDeviceInvitation(encoded: string): {endpoint: string; invitation: string} {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(encoded)) throw new Error('Invalid installation invitation.');
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const endpoint = new URL(value.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^[A-Za-z0-9_-]{43}$/.test(value.invitation)) throw new Error('Invalid installation invitation.');
  return {endpoint: endpoint.toString().replace(/\/$/, ''), invitation: value.invitation};
}

