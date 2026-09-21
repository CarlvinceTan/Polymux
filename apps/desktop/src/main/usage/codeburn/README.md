# Local usage parsers

Vendored from [CodeBurn](https://github.com/getagentseal/codeburn), commit
`b0e53cfc`, MIT (see LICENSE), following Midas's local agent statistics integration.
Midas's copy supplies the parser core; optional adapters absent there are from
that same upstream revision. Only the transitive parser/pricing dependency tree
is included. This is bundled into an isolated worker, not loaded from Midas.

Polymux changes:
- Home discovery reads the worker-local environment (Node os.homedir otherwise
  uses the parent process environment), including synthetic test homes.
- Relative TypeScript imports use `.js` specifiers for the app build.
- Provider discovery excludes network-only adapters and Polymux-managed roots
  (resolved through symlinks), and exposes discovery failures.
- The worker disables nested parser workers and network pricing refreshes.
  Prices use the bundled snapshot; missing prices remain incomplete.
- Parser caches live in Polymux's private usage-cache directory. Only usage
  buckets, opaque session IDs, model names, agent names and scan status cross
  back to the main process. No prompt text or tool arguments reach the renderer.

The registry discovers supported local session files and databases. It cannot
account for deleted history, unsupported formats, remote machines, or cloud-only
activity. Some adapters estimate tokens; the UI marks scans containing estimates.
