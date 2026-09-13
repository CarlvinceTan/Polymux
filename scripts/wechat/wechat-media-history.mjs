import { createHash } from "node:crypto";
import path from "node:path";
import { freshSentRows, historyMessageId } from "./wechat-message-history.mjs";

/**
 * Returns the exact WeChat server id for one newly sent media item.
 *
 * File, video, and voice sends are fail-closed: an unrelated same-kind row
 * must never turn a native submission failure into a reported success.
 * Re-encoded pictures and videos need the exact native acknowledgement id; an
 * arbitrary new row of the same kind can belong to a concurrent phone send.
 */
export function sentMediaMessageId(
  rows,
  { mediaType, bytes, sinceEpoch, expectedName, excludedIds, expectedMessageId, selfWxid },
) {
  const expectedKinds = {
    image: new Set(["image"]),
    video: new Set(["video"]),
    audio: new Set(["audio"]),
    file: new Set(["attachment", "file"]),
  }[mediaType];
  const md5 = createHash("md5").update(bytes).digest("hex");
  const filename = expectedName
    ? path.basename(String(expectedName)).normalize("NFC")
    : "";
  const candidates = freshSentRows(rows, {sinceEpoch, excludedIds, expectedMessageId, selfWxid}).filter(
    (row) =>
      expectedKinds?.has(row.message_kind) &&
      row.server_id != null && String(row.server_id) !== "0" &&
      Number(row.create_time ?? 0) >= sinceEpoch,
  );
  const exact = candidates.filter((row) => {
    const remoteLength = Number(
      row.media?.length ??
        row.media?.total_size ??
        row.media?.size ??
        row.media?.size_bytes ??
        Number.NaN,
    );
    const remoteMd5 = String(row.media?.md5 ?? "").toLowerCase();
    const remoteFilename = String(row.media?.filename ?? "").normalize("NFC");
    if (remoteMd5) return remoteMd5 === md5;
    if (mediaType === "file") return Boolean(
      filename &&
      remoteFilename === filename &&
      Number.isFinite(remoteLength) &&
      remoteLength === bytes.byteLength,
    );
    return Boolean(
      mediaType !== "image" &&
      Number.isFinite(remoteLength) &&
      remoteLength === bytes.byteLength,
    );
  });
  // WeChat re-encodes an outgoing video, so the delivered bytes legitimately
  // differ from the local file. Re-encoding is not proof of ownership though: a
  // video this account sent from its phone can sync inside the boundary and be
  // the only new row, which would report someone else's message as ours. Video
  // is therefore acknowledged only by the exact id the sender reported, and
  // otherwise stays unconfirmed.
  const matches = exact.length
    ? exact
    : expectedMessageId && (mediaType === "image" || mediaType === "video")
      ? candidates
      : [];
  return matches.length === 1 ? historyMessageId(matches[0]) : undefined;
}
