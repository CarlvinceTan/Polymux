import {DOMParser} from '@xmldom/xmldom';

/** Desktop appmsg type 8 embeds its sticker reference as a small protobuf.
 * Only its digest and ordinary download URL are exposed, never the AES key. */
export function weChatAppSticker(xml: string): {md5: string; cdnUrl: string | null} | null {
  if (!xml || xml.length > 128 * 1024 || /<!DOCTYPE/i.test(xml)) return null;
  try {
    const doc = new DOMParser({onError: () => {throw new Error('Invalid sticker XML');}}).parseFromString(xml, 'text/xml');
    const text = (tag: string) => doc.getElementsByTagName(tag).item(0)?.textContent?.trim() ?? '';
    if (text('type') !== '8') return null;
    const md5 = text('emoticonmd5').toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(md5)) return null;
    const encoded = text('emojiinfo');
    if (!encoded) return {md5, cdnUrl: null};
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > 64 * 1024) return null;
    const bytes = Buffer.from(encoded, 'base64');
    let at = 0;
    const number = (): number => {
      let result = 0;
      for (let shift = 0; shift <= 49 && at < bytes.length; shift += 7) {
        const value = bytes[at++]; result += (value & 127) * 2 ** shift;
        if (!Number.isSafeInteger(result)) break;
        if (!(value & 128)) return result;
      }
      throw new Error('Invalid sticker field');
    };
    const fields = new Map<number, Buffer>();
    while (at < bytes.length) {
      const tag = number(), field = Math.floor(tag / 8), wire = tag % 8;
      if (!field) return null;
      if (wire === 0) {number(); continue;}
      const size = wire === 2 ? number() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (size < 0 || at + size > bytes.length) return null;
      if (wire === 2 && (field === 1 || field === 2)) {
        if (fields.has(field)) return null;
        fields.set(field, bytes.subarray(at, at + size));
      }
      at += size;
    }
    if (fields.get(1)?.toString() !== md5) return null;
    const url = new URL(fields.get(2)?.toString() ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return {md5, cdnUrl: url.href};
  } catch {return null;}
}
