const web = globalThis.crypto;

export const webcrypto = web;
export default web;
export function randomBytes(size) {
  const bytes = new Uint8Array(size);
  web.getRandomValues(bytes);
  return bytes;
}
