#!/usr/bin/env python3
"""Tiny reader for agents/lanes.toml. Usage: lanes.py get KEY | lane NAME FIELD | order [FIRST]"""
import ast, datetime, os, sys
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
cfg = load((Path(__file__).resolve().parents[1] / "agents/lanes.toml").read_text())
def usable(n):
    l = cfg[n]
    if l.get("enabled", True) is False: return False
    u = l.get("until")
    return not (u and datetime.date.today() > datetime.date.fromisoformat(u))
a = sys.argv[1:]
if a[0] == "get": print(os.path.expanduser(str(cfg.get(a[1], ""))))
elif a[0] == "lane": print(os.path.expanduser(str(cfg.get(a[1], {}).get(a[2], ""))))
elif a[0] == "order":
    names = [k for k, v in cfg.items() if isinstance(v, dict) and usable(k)]
    if len(a) > 1 and a[1] in cfg: names = [a[1]] + [n for n in names if n != a[1]]
    print(" ".join(names))
