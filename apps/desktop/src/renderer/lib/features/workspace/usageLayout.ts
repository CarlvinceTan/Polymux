/** Share the available vertical space between grid rows, stopping once each
 * section fits. Short panes retain every heading and a route to hidden rows. */
export function usageRowLimits(width: number, height: number, lengths: number[]): number[] {
  const columns = width > 640 ? 3 : width > 480 ? 2 : 1;
  const groups = Array.from({length: Math.ceil(lengths.length / columns)}, (_, index) =>
    Math.max(...lengths.slice(index * columns, (index + 1) * columns)),
  );
  const limits = groups.map(() => 0);
  let available = Math.max(0, Math.floor((height - groups.length * 18 - Math.max(0, groups.length - 1) * 10) / 24));
  while (available > 0) {
    let changed = false;
    for (let index = 0; index < groups.length && available > 0; index += 1) {
      if (limits[index] >= groups[index]) continue;
      limits[index] += 1;
      available -= 1;
      changed = true;
    }
    if (!changed) break;
  }
  return lengths.map((length, index) => Math.min(length, limits[Math.floor(index / columns)]));
}
