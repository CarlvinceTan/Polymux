export interface BoundedOutput {
  visible: string;
  truncated: boolean;
  omittedBytes: number;
}

export function boundOutput(
  value: string,
  maxBytes = 50 * 1024,
  maxLines = 2_000,
): BoundedOutput {
  const lines = value.split("\n");
  let visible =
    lines.length > maxLines ? lines.slice(-maxLines).join("\n") : value;
  const bytes = Buffer.byteLength(visible);
  let omittedBytes = Buffer.byteLength(value) - bytes;
  if (bytes > maxBytes) {
    const buffer = Buffer.from(visible);
    visible = buffer.subarray(buffer.length - maxBytes).toString("utf8");
    omittedBytes += bytes - Buffer.byteLength(visible);
  }
  return {
    visible,
    truncated: omittedBytes > 0,
    omittedBytes: Math.max(0, omittedBytes),
  };
}
