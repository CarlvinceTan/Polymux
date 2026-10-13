#!/bin/bash
# Read-only: latest state per task from ~/ops/lanes/events.tsv (queued, running, failed,
# pr, needs_cody) with timestamps and age. Flags running >1h and no PR in 3h.
OPS=${LANES_HOME:-$HOME/ops/lanes}; EV="$OPS/events.tsv"
[ -f "$EV" ] || { echo "no events yet ($EV)"; exit 0; }
python3 - "$EV" "$OPS" <<'PY'
import sys, os, datetime as dt
rows=[l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
now=dt.datetime.now(); last={}; first={}; lastpr=None
for r in rows:
    r += [""]*(5-len(r)); t=dt.datetime.strptime(r[0],"%Y-%m-%d %H:%M:%S")
    first.setdefault(r[1],t); last[r[1]]=(t,r)
    if r[2]=="pr": lastpr=t
print(f"{'state':10} {'since':19} {'age':>6}  {'task':34} lane/detail")
for k,(t,r) in sorted(last.items(), key=lambda x:x[1][0]):
    age=int((now-t).total_seconds()//60); flag=" STUCK>1h" if r[2]=="running" and age>60 else ""
    print(f"{r[2]:10} {r[0]:19} {age:>5}m  {k[:34]:34} {r[3]} {r[4]}{flag}")
if lastpr is None or (now-lastpr).total_seconds()>3*3600:
    print("WARN: no PR opened in the last 3h" + ("" if lastpr is None else f" (last {lastpr:%F %T})"))
if os.path.exists(os.path.join(sys.argv[2],"NEEDS_CODY")): print("NEEDS_CODY marker present:", os.path.join(sys.argv[2],"NEEDS_CODY"))
PY
