import {parentPort, workerData} from 'node:worker_threads';
import {mkdir} from 'node:fs/promises';

// Worker-only environment: never mutate the app's HOME or agent configuration.
process.env.CODEBURN_CACHE_DIR = workerData.cacheDirectory;
process.env.CODEBURN_PARSE_WORKERS = '0';
process.env.CODEBURN_PRICING_SNAPSHOT_ONLY = '1';
process.env.POLYMUX_USAGE_EXCLUDED_ROOTS = JSON.stringify(workerData.excludedRoots);

try {
  await mkdir(workerData.cacheDirectory, {recursive: true, mode: 0o700});
  const [{parseAllSessions, sessionHydrationSnapshot}, {loadPricing}, {getAllProviders, discoveryFailures}, {aggregateLocalUsage}] = await Promise.all([
    import('./codeburn/parser.js'), import('./codeburn/models.js'),
    import('./codeburn/providers/index.js'), import('./aggregate.js'),
  ]);
  await loadPricing();
  const projects = await parseAllSessions(undefined, 'all');
  const result = aggregateLocalUsage(projects);
  parentPort?.postMessage({...result, discovery: {
    status: sessionHydrationSnapshot().complete && discoveryFailures().length === 0 ? 'ready' : 'partial',
    updatedAt: new Date().toISOString(),
    detectedAgents: new Set(result.source.runs.map(row => row.agent?.id)).size,
    supportedAgents: (await getAllProviders()).length,
    estimated: result.estimated,
  }});
} catch {
  // Logs may contain personal file paths. Only a bounded status crosses IPC.
  parentPort?.postMessage({error: true});
} finally {
  parentPort?.close();
}
