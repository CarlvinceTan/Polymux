#!/bin/bash
# dispatch-guard.sh <unit-file> <target>   exit 0 = may dispatch, 4 = REFUSED (no claim, no retry)
# Rule (verify-before-done 7): Xcode/Swift work runs only on a Mac lane host (mac_hosts in
# agents/lanes.toml). Unit file fields:
#   unit: polymux/NC   needs: xcode,swift | go | none   scope: apps/Polymux/**,packages/X/*
# Used by run-lane.sh, pick-coder and any cloud launcher. Refusals go to Chief's intake
# (~/ops/events/dispatch-refusals.jsonl, one JSON line, notify Chief).
if [ "${1:-}" = --brief ]; then
  python3 - "$2" "$3" <<'PYBRIEF'
import json, pathlib, re, subprocess, sys
brief, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).resolve()
text = brief.read_text()
def stop(kind, reason):
    print(f"{kind}: {reason}")
    sys.exit(4)
def gh(*args):
    p = subprocess.run(["gh", "pr", *args, "-R", "CarlvinceTan/polymux"], capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else ""
refs = re.findall(r"^after:[ \t]*(.*)$", text, re.M)
for ref in re.split(r"[ ,]+", " ".join(refs)):
    if ref.lower() in ("", "none", "-"): continue
    if re.fullmatch(r"pr:[0-9]+", ref):
        met = gh("view", ref[3:], "--json", "state", "-q", ".state") == "MERGED"
    elif ref.startswith("branch-on-main:"):
        branch = ref.split(":", 1)[1]
        n = gh("list", "--state", "merged", "--head", branch.removeprefix("origin/"), "--json", "number", "--limit", "1", "-q", '.[0].number // "none"')
        met = n.isdigit() and int(n) > 0
        if not met:
            p = subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", branch, "origin/main"], capture_output=True)
            met = p.returncode == 0
    else: met = False
    if not met: stop("dep", f"UNMET {ref}")
if not refs:
    for deps in re.findall(r"^[Dd]eps:[ \t]*(.*)$", text, re.M):
        for token in re.split(r"[ ,]+", deps):
            unit = token.rstrip(".;:!?)\"'`]")
            if unit.lower() in ("", "none", "-"): continue
            # Bare labels such as SB1 are ambiguous prose; require a namespace.
            if not re.fullmatch(r"(?:pr:[0-9]+|[a-z][a-z0-9-]*/[A-Z][A-Z0-9-]*)", unit):
                print(f"warning: ignored Deps: {token}", file=sys.stderr)
                continue
            if unit.startswith("pr:"):
                met = gh("view", unit[3:], "--json", "state", "-q", ".state") == "MERGED"
            else:
                n = gh("list", "--state", "merged", "--search", unit, "--json", "title", "--limit", "100")
                try: met = any(re.match(r"^#?\s*" + re.escape(unit) + r"(?:\s|:|$)", pr["title"]) for pr in json.loads(n))
                except (ValueError, TypeError, KeyError): met = False
            if not met: stop("dep", f"Deps: {unit} is not merged; add after: refs")
pattern = r"(?<![\w/.~-])((?:[\w.-]+/)*[\w.-]+\.(?:md|task))(?:#([\w.-]+)|[ `]*§\s*([\d.]+))?"
branch = re.search(r"^branch:[ \t]*(\S+)", text, re.M)
for line in text.splitlines():
    header = re.match(r"^[Ss]pec:[ \t]*", line)
    for match in re.finditer(pattern, line):
        name, anchor, section = match.groups()
        if not header and not (anchor or section): continue
        if name == "QUEUE.md" or name.startswith(("queue/", "queue-hold/", ".proof/")): continue
        # Instructions to create a document describe outputs, even with anchors.
        if re.search(r"\b(?:create|write|generate|save|produce)\s+(?:the\s+)?(?:file\s+)?[`\"']?$", line[:match.start()], re.I): continue
        path = (root / name).resolve()
        if not path.is_relative_to(root): stop("spec", f"missing brief/spec path {name}")
        content = path.read_text() if path.is_file() else None
        if content is None and branch:
            rev = subprocess.run(["git", "-C", str(root), "rev-parse", "--verify", "--end-of-options", branch[1] + "^{commit}"], capture_output=True, text=True)
            if rev.returncode == 0:
                doc = subprocess.run(["git", "-C", str(root), "show", rev.stdout.strip() + ":" + name], capture_output=True, text=True)
                if doc.returncode == 0: content = doc.stdout
        if content is None: stop("spec", f"missing brief/spec path {name}")
        headings = re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", content, re.M)
        if anchor and not any(re.sub(r"[^\w -]", "", h.lower()).replace(" ", "-") == anchor.lower() for h in headings):
            stop("spec", f"missing section {name}#{anchor}")
        if section and not any(re.match(re.escape(section.rstrip(".")) + r"(?:[. ]|$)", h) for h in headings):
            stop("spec", f"missing section {name} §{section}")
PYBRIEF
  exit $?
fi
F=$1; T=${2:?target}; MACS=$(python3 "$(dirname "$0")/lanes.py" list mac_hosts); INTAKE=${DISPATCH_INTAKE:-$HOME/ops/events/dispatch-refusals.jsonl}
field() { [ -f "$F" ] && sed -n "s/^$1: *//p" "$F" | head -1; }
U=$(field unit); U=${U:-$(basename "$F" .task)}; N=$(field needs); S=$(field scope)
[ -z "$S" ] && [ -f "$F" ] && S=$(sed -n 's/^Files in scope: *//p' "$F" | head -1)   # goal-loop briefs
OS=linux; case " $MACS " in *" $T "*) OS=macos;; esac
refuse() { echo "$1"; mkdir -p "$(dirname "$INTAKE")"
  printf '{"ts":"%s","type":"dispatch_refused","unit":"%s","target":"%s","msg":"%s","notify":["Chief"],"delivered":false}\n' \
    "$(date -u +%FT%TZ)" "$U" "$T" "$(echo "$1" | sed 's/"/\\"/g')" >> "$INTAKE"; exit 4; }
APPLE=""; echo ",$N," | grep -qiE ',(xcode|swift|simulator|ios|macos|ios-sim),' && APPLE=$N
if echo "$S" | tr ',' '\n' | grep -qE '^apps/Polymux|\.swift$|\.xcodeproj|(^|/)Package\.swift$|PolymuxKit|/Sources/'; then
  APPLE=${APPLE:-xcode,swift}; fi
if [ -n "$APPLE" ] && [ "$OS" != macos ]; then
  refuse "REFUSED $U -> $T ($OS): unit needs $APPLE (apps/Polymux macOS). Fix: dispatch to a Mac lane host ($MACS) with \`ssh <host> 'scripts/run-lane.sh <lane> $U'\`, or remove the Swift paths from the unit's scope. Rule: verify-before-done 7."
fi
[ -n "$N" ] || refuse "REFUSED $U: no \`needs:\` field. Fix: add e.g. \`needs: xcode,swift\` to the unit brief, then re-dispatch."
echo "dispatch OK: $U -> $T (needs $N)"
