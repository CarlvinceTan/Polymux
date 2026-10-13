#!/usr/bin/env python3
"""Tiny reader for agents/lanes.toml.
Usage: lanes.py get KEY | list KEY | lane NAME FIELD | order [FIRST] | primaries | usable NAME | forbidden TITLE | mainkey NAME (exit 0/1) | maxconc NAME
Lane fields honour a per-host override `field@<host>` (host = LANES_HOST or hostname -s)."""
import ast, datetime, os, socket, sys
from pathlib import Path
def load(text):  # minimal TOML subset (tables, key = "str"|int|bool); macOS python3 is 3.9
    cfg, cur = {}, None
    for line in text.splitlines():
        line = line.split(" #")[0].strip()
        if not line or line.startswith("#"): continue
        if line.startswith("["): cur = cfg.setdefault(line.strip("[]"), {}); continue
        k, v = (x.strip() for x in line.split("=", 1))
        v = {"true": True, "false": False}.get(v, v)
        (cur if cur is not None else cfg)[k] = ast.literal_eval(v) if isinstance(v, str) else v
    return cfg
cfg = load(Path(os.environ.get("LANES_TOML") or Path(__file__).resolve().parents[1] / "agents/lanes.toml").read_text())
def usable(n):
    l = cfg[n]
    if l.get("enabled", True) is False: return False
    u = l.get("until")
    return not (u and datetime.date.today() > datetime.date.fromisoformat(u))
# Main (Ultra) account markers, case-insensitive substrings; forbidden_keys titles are added.
MAIN_MARKERS = ["ultra", "carlvincetan@gmail", "cvmini cursor-agent"]
def is_main(v):
    v = str(v).strip().lower()
    if not v: return False
    marks = MAIN_MARKERS + [str(x).lower() for x in cfg.get("forbidden_keys", [])] + [str(x).lower() for x in cfg.get("main_markers", [])]
    return any(m and m in v for m in marks)
a = sys.argv[1:]
if a[0] == "get": print(os.path.expanduser(str(cfg.get(a[1], ""))))
elif a[0] == "list": v = cfg.get(a[1], []); print(" ".join(v if isinstance(v, list) else [str(v)]))
elif a[0] == "lane":
    host = os.environ.get("LANES_HOST") or socket.gethostname().split(".")[0]
    l = cfg.get(a[1], {}); print(os.path.expanduser(str(l.get(a[2] + "@" + host, l.get(a[2], "")))))
elif a[0] == "forbidden":  # exit 0 if the vault title is a main-account key
    sys.exit(0 if is_main(a[1]) else 1)
elif a[0] == "mainkey":  # exit 0 if lane NAMEs key/account/env, or the callers env, points at the main account
    host = os.environ.get("LANES_HOST") or socket.gethostname().split(".")[0]
    l = cfg.get(a[1], {}) if isinstance(cfg.get(a[1]), dict) else {}
    vals = [str(v) for k, v in l.items() if k.split("@")[0] in ("key", "account", "env") or k.split("@")[0].startswith("env")]
    vals += [os.environ.get(e, "") for e in ("LANE_KEY_TITLE", "CURSOR_KEY_TITLE", "CURSOR_ACCOUNT")]
    sys.exit(0 if any(is_main(v) for v in vals) else 1)
elif a[0] == "maxconc":  # per-lane concurrent run cap (0 = not set; lane-guard dispatches one per lane)
    l = cfg.get(a[1], {}); print(int(l.get("max_concurrent", 0)) if isinstance(l, dict) else 0)
elif a[0] == "usable":  # run-lane gate: unknown, disabled or expired lanes never run
    sys.exit(0 if isinstance(cfg.get(a[1]), dict) and usable(a[1]) else 1)
elif a[0] == "primaries":  # dispatch rotation: primaries only; fallback lanes only if no primary is usable
    names = [k for k, v in cfg.items() if isinstance(v, dict) and usable(k)]
    pri = [n for n in names if cfg[n].get("role") != "fallback"]
    print(" ".join(pri or names))
elif a[0] == "order":
    names = [k for k, v in cfg.items() if isinstance(v, dict) and usable(k)]
    # role = "fallback" lanes go last (reached only when primaries fail or are unusable).
    names = [n for n in names if cfg[n].get("role") != "fallback"] + [n for n in names if cfg[n].get("role") == "fallback"]
    # A requested first lane is honoured only if usable and primary: disabled lanes never run or receive failover.
    if len(a) > 1 and a[1] in names and cfg[a[1]].get("role") != "fallback": names = [a[1]] + [n for n in names if n != a[1]]
    print(" ".join(names))
