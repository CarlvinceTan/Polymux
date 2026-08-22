const ORDINARY_HOMESERVER_PORT = 47_664;
const BACKGROUND_BENCHMARK_HOMESERVER_PORT = 47_865;

/** Keep every launch route's homeserver ownership aligned with its userData
 * directory. The packaged background benchmark has its own single-instance
 * lock and must therefore never contend for the ordinary session's port. */
export function homeserverPortFor(
  devInstance: string | undefined,
  backgroundLaunch = false,
): number {
  if (backgroundLaunch && !devInstance) return BACKGROUND_BENCHMARK_HOMESERVER_PORT;
  if (!devInstance) return ORDINARY_HOMESERVER_PORT;
  let hash = 0;
  for (const character of devInstance)
    hash = (hash * 31 + character.charCodeAt(0)) % 200;
  // A named hidden benchmark has both suffixes in its userData identity, so it
  // must also have a port distinct from the fixed packaged benchmark and from
  // ordinary named isolates.
  if (backgroundLaunch) return 47_866 + hash;
  return 47_665 + hash;
}
