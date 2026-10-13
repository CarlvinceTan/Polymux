#!/usr/bin/env python3
"""Map paths changed since BASE to the verify targets they can break (VERIFY_TARGETS=affected).

Prints shell assignments for verify.sh to eval:
  GO_PKGS   "all" | "" | space-separated ./relative Go packages (changed + reverse deps, via go list)
  SWIFT     "all" | "" | regex for `swift test --filter` (test targets depending on changed targets,
            via Package.swift dependencies from `swift package dump-package`)
  APP       1 when the Xcode app (macOS/iOS builds, UI tests) can be affected, else 0
  WHY       one-line reason
Any changed path it cannot map runs everything: a wrong "skip" is worse than a slow verify.
"""
import json, os, re, subprocess, sys

base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
def sh(*a, cwd=None):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, check=True).stdout
def out(go, sw, app, why):
    q = lambda s: "'" + s.replace("'", "'\\''") + "'"
    print(f"GO_PKGS={q(go)}\nSWIFT={q(sw)}\nAPP={app}\nWHY={q(why)}"); sys.exit(0)

try:
    changed = [p for p in sh("git", "diff", "--name-only", f"{base}...HEAD").splitlines() if p]
    changed += [p for p in sh("git", "diff", "--name-only", "HEAD").splitlines() if p]  # uncommitted work
except subprocess.CalledProcessError as e:
    out("all", "all", 1, f"git diff {base} failed: {e.stderr.strip()}")
changed = sorted(set(changed))
if not changed: out("", "", 0, "no changed paths")

GLOBAL = re.compile(r"^(Package\.swift|Package\.resolved|go\.work(\.sum)?|contracts/|packages/CSQLite/)")
# Lane-only scripts: covered by lane-tests / merge-queue tests, not by the app build. Every OTHER file under
# scripts/ (verify.sh, affected.py, lanelib.sh, wt-setup.sh, fetch_cua.py, templates/...) is verify tooling:
# a PR that changes verify must not be checked by its own skipping verify, so it runs full.
LANE_ONLY = re.compile(r"^scripts/(run-lane|cleanup|dispatch-guard|test-lanes|bootstrap-mac|board-update|test-board|approve-proof|lane-status|merge-queue|test-merge-queue|review-verdict|queue-write)\.sh$|^scripts/(lanes|media-check|verdict)\.py$")
INERT = re.compile(r"^(docs/|specs/|agents/|[^/]+\.md$|apps/server/[^/]*\.md$|LICENSE$|\.github/)|\.md$")
def inert(p): return bool(INERT.search(p) or LANE_ONLY.match(p))
for p in changed:
    if GLOBAL.match(p): out("all", "all", 1, f"{p} is shared by every target")
    if p.startswith("scripts/") and not LANE_ONLY.match(p) and not p.endswith(".md"):
        out("all", "all", 1, f"{p} is verify tooling")

# --- Go: changed packages + every package that imports them (tests included) ---------------
SRV = "apps/server"
go_files = [p for p in changed if p.startswith(SRV + "/")]
go_pkgs = ""
if any(re.match(rf"^{SRV}/go\.(mod|sum)$", p) for p in go_files): go_pkgs = "all"
elif go_files:
    mod = sh("go", "list", "-m", cwd=SRV).strip()
    info = {}
    for line in sh("go", "list", "-tags", "sqlite_fts5 verifyfixture", "-f",
                   "{{.ImportPath}}|{{.Dir}}|{{join .Imports \" \"}} {{join .TestImports \" \"}} {{join .XTestImports \" \"}}",
                   "./...", cwd=SRV).splitlines():
        ip, d, imps = line.split("|", 2); info[ip] = (os.path.relpath(d, os.path.abspath(SRV)), set(imps.split()))
    dirs = {d: ip for ip, (d, _) in info.items()}
    hit = set()
    for p in go_files:
        rel = os.path.dirname(p[len(SRV) + 1:]) or "."
        if rel in dirs: hit.add(dirs[rel])
        elif p.endswith(".go") or "testdata" in p or not inert(p):
            # file in a non-package dir (testdata, embedded asset): owning package = longest prefix
            own = max((d for d in dirs if rel == d or rel.startswith(d + "/")), key=len, default=None)
            if own is None: go_pkgs = "all"; break
            hit.add(dirs[own])
    if go_pkgs != "all":
        grew = True
        while grew:  # reverse import closure
            grew = False
            for ip, (_, imps) in info.items():
                if ip not in hit and imps & hit: hit.add(ip); grew = True
        go_pkgs = " ".join(sorted("./" + info[ip][0] for ip in hit))

# --- Swift: map files to Package.swift targets, then test targets that depend on them --------
dump = json.loads(sh("swift", "package", "dump-package"))
targets = {}
for t in dump["targets"]:
    deps = set()
    for d in t.get("dependencies", []):
        v = next(iter(d.values())); deps.add(v[0] if isinstance(v, list) else v)
    targets[t["name"]] = (t.get("path") or "", t["type"], deps)
swift_hit = set(); app = 0; unmapped = []; swift_all = False
for p in changed:
    if p.startswith(SRV + "/") or inert(p): continue
    owner = max((n for n, (d, _, _) in targets.items() if d and p.startswith(d + "/")),
                key=lambda n: len(targets[n][0]), default=None)
    if owner: swift_hit.add(owner)
    if p.startswith("apps/Polymux/") or p.startswith("packages/"):
        app = 1   # the Xcode app links the packages and compiles apps/Polymux/Sources directly
        if not owner: swift_all = True   # ownerless non-doc file (resource, new dir): every Swift target
        continue
    if not owner: unmapped.append(p)
if unmapped: out("all", "all", 1, "unmapped paths: " + " ".join(unmapped[:5]))
grew = True
while grew:
    grew = False
    for n, (_, _, deps) in targets.items():
        if n not in swift_hit and deps & swift_hit: swift_hit.add(n); grew = True
tests = sorted(n for n in swift_hit if targets[n][1] == "test")
swift = "all" if swift_all else (("^(" + "|".join(tests) + r")\.") if tests else "")
out(go_pkgs, swift, app, f"{len(changed)} changed paths")
