/** Add Electron's app-owned nonfrontmost launch switch to named development
 * instances. Forge accepts Electron arguments only after its `--` separator. */
export function backgroundInstanceArguments(forwarded, instance, visible = false) {
  const args = [...forwarded];
  if (!instance || visible || args.includes('--flareai-background')) return args;
  const separator = args.indexOf('--');
  if (separator < 0) return [...args, '--', '--flareai-background'];
  args.splice(separator + 1, 0, '--flareai-background');
  return args;
}
