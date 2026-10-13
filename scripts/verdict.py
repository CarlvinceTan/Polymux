#!/usr/bin/env python3
"""Signed review verdicts (Liam -> merge lane). The HMAC key arrives on stdin (first line), never argv/env/files.
  verdict.py sign PR SHA PASS|FIX          -> prints the hex HMAC-SHA256 over "PR|SHA|VERDICT"
  verdict.py newest PR COMMENTS.jsonl      -> prints "<PASS|FIX> <sha>" for the newest VALID verdict, or "NONE"
A comment is a valid verdict only if ALL hold: author login in MERGE_REVIEWERS (default CarlvinceTan);
not a merge-queue comment (<!-- polymux-merge-queue -->); body starts exactly with "Liam: PASS" or "Liam: FIX";
it carries <!-- verdict:v1 pr=<PR> sha=<40 hex> v=<same verdict> mac=<hex> --> with a correct HMAC; and the
visible text names that sha (full or a 7+ char prefix). Everything else is ignored, EXCEPT (fail closed):
any comment from an allowed login whose body starts with a FIX/CHANGES verdict ("Liam: FIX", "FIX",
"Liam: CHANGES", "Changes requested", any case), signed or not, posted after the newest valid PASS
blocks it: newest prints "FIX unsigned"."""
import hashlib, hmac, json, os, re, sys
NEG = re.compile(r"^\s*(liam\s*:\s*)?(fix|changes)\b", re.I)
QUEUE_MARK = "<!-- polymux-merge-queue -->"
MARK = re.compile(r"<!-- verdict:v1 pr=(\d+) sha=([0-9a-f]{40}) v=(PASS|FIX) mac=([0-9a-f]{64}) -->")
def mac(key, pr, sha, v): return hmac.new(key, f"{pr}|{sha}|{v}".encode(), hashlib.sha256).hexdigest()
key = sys.stdin.readline().rstrip("\n").encode()
if not key: sys.exit("verdict: empty key")
a = sys.argv[1:]
if a[0] == "sign": print(mac(key, a[1], a[2], a[3])); sys.exit(0)
pr = a[1]; cs = [json.loads(l) for l in open(a[2]) if l.strip()]; allowed = set(os.environ.get("MERGE_REVIEWERS", "CarlvinceTan").split(","))
best = None
for c in sorted(cs, key=lambda c: (c.get("created_at") or "", c.get("id") or 0)):
    b = c.get("body") or ""; login = (c.get("user") or {}).get("login") or (c.get("author") or {}).get("login")
    if login not in allowed or QUEUE_MARK in b: continue
    m = MARK.search(b)
    if not m or m.group(1) != pr:
        if NEG.match(b): best = ("FIX", "unsigned")   # fail closed: an unsigned FIX/CHANGES still blocks
        continue
    v, sha = m.group(3), m.group(2)
    if not b.startswith("Liam: " + v) or not hmac.compare_digest(m.group(4), mac(key, pr, sha, v)):
        if NEG.match(b): best = ("FIX", "unsigned")   # a forged/malformed FIX still blocks; a forged PASS never approves
        continue
    vis = b.replace(m.group(0), "")
    if not any(sha.startswith(t) for t in re.findall(r"\b[0-9a-f]{7,40}\b", vis)):
        if v == "FIX": best = ("FIX", sha)
        continue
    best = (v, sha)
print("%s %s" % best if best else "NONE")
