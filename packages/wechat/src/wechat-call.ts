import {DOMParser} from "@xmldom/xmldom";

/** Read only the visible call caption. Other VoIP fields include private
 * transport identifiers; the numeric duration can be zero even for long calls. */
export function weChatCallText(xml: string): string | null {
  if (!xml || xml.length > 128 * 1024 || /<!DOCTYPE/i.test(xml)) return null;
  try {
    const doc = new DOMParser({onError: () => {throw new Error("Invalid call XML");}})
      .parseFromString(xml, "text/xml");
    const calls = doc.getElementsByTagName("voipmsg");
    if (calls.length !== 1) return null;
    const captions = calls.item(0)!.getElementsByTagName("msg");
    if (captions.length !== 1) return null;
    const text = captions.item(0)!.textContent?.trim();
    return text && text.length <= 512 ? text : null;
  } catch {return null;}
}
