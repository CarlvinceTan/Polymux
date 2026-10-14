"""Frame-time stats for the Release scroll window in frames.log.

Reads the epoch window scroll-cua.py recorded and reports median/p95/max frame
time (ms) plus the rate of intervals over 1.5x the measured display period (a
missed refresh). Writes scroll-stats.json next to the log.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
window = json.loads((HERE / "scroll-window.json").read_text())
header = (HERE / "frames.log").read_text().splitlines()[0]
rows = sorted(float(line.split()[1]) for line in (HERE / "frames.log").read_text().splitlines()
              if line and not line.startswith("#")
              and window["t0"] <= float(line.split()[0]) <= window["t1"])


def percentile(p):
    return rows[min(len(rows) - 1, int((len(rows) - 1) * p))]


refresh = percentile(0.10)
hitches = [ms for ms in rows if ms > refresh * 1.5]
stats = {
    "configuration": "Release" if "[Release]" in header else "unknown",
    "frames": len(rows),
    "medianMs": round(percentile(0.50), 3),
    "p95Ms": round(percentile(0.95), 3),
    "maxMs": round(rows[-1], 3),
    "refreshMs": round(refresh, 3),
    "hitchThresholdMs": round(refresh * 1.5, 3),
    "hitches": len(hitches),
    "hitchRate": round(len(hitches) / len(rows), 4),
    "scrollSeconds": window["seconds"],
}
(HERE / "scroll-stats.json").write_text(json.dumps(stats, indent=2, sort_keys=True) + "\n")
print(json.dumps(stats, indent=2, sort_keys=True))
