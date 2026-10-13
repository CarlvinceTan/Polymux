#!/usr/bin/env python3
"""batch_plan.py N TASK... -> one batch: up to N task files whose scope: globs don't overlap.
Prints the chosen paths, oldest first. A task without scope: is never batched (overlap can't be
ruled out, so it stays for run-lane.sh). Two globs overlap when the literal prefix (up to the first
* ? or [) of one is a prefix of the other's: one writer per file, conservatively."""
import re, sys
def scope(p):
    for line in open(p, errors="replace"):
        if line.startswith("scope:"): return [g.strip() for g in line[6:].split(",") if g.strip()]
    return []
def pre(g): return re.split(r"[*?\[]", g, 1)[0]
def overlap(a, b):
    for x in a:
        for y in b:
            px, py = pre(x), pre(y)
            if px.startswith(py) or py.startswith(px): return True
    return False
n, picked, used = int(sys.argv[1]), [], []
for t in sorted(sys.argv[2:]):
    s = scope(t)
    if not s or any(overlap(s, u) for u in used): continue
    picked.append(t); used.append(s)
    if len(picked) >= n: break
print("\n".join(picked))
