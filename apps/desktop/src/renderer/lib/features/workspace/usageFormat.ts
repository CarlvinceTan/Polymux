export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${trimDecimal(abs / 1e9)}bn`;
  if (abs >= 1e6) return `${sign}${trimDecimal(abs / 1e6)}m`;
  if (abs >= 1e3) return `${sign}${trimDecimal(abs / 1e3)}k`;
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function heatmapLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

export function pluginHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1)
    hash = (hash * 33 + name.charCodeAt(index)) >>> 0;
  return hash % 360;
}

function trimDecimal(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}
