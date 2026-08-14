#!/usr/bin/env python3
"""Select the smallest Chronicle summary set covering an ISO-8601 time range."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sys


NAME_RE = re.compile(
    r"^(?P<stamp>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-.+?-"
    r"(?P<count>\d+)(?P<unit>min|mins|minute|minutes|h|hr|hrs|hour|hours)"
    r"-memory-summary\.md$",
    re.IGNORECASE,
)
UNIT_MINUTES = {
    "min": 1,
    "mins": 1,
    "minute": 1,
    "minutes": 1,
    "h": 60,
    "hr": 60,
    "hrs": 60,
    "hour": 60,
    "hours": 60,
}


@dataclass(frozen=True)
class Summary:
    path: Path
    start: datetime
    end: datetime
    duration_minutes: int

    def as_dict(self) -> dict:
        return {
            "path": str(self.path),
            "start": iso_z(self.start),
            "end": iso_z(self.end),
            "duration_minutes": self.duration_minutes,
        }


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_input_time(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith(("Z", "z")) else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        raise ValueError("time must include Z or an explicit UTC offset")
    return parsed.astimezone(timezone.utc)


def parse_summary(path: Path) -> Summary | None:
    match = NAME_RE.match(path.name)
    if not match:
        return None
    start = datetime.strptime(match.group("stamp"), "%Y-%m-%dT%H-%M-%S").replace(
        tzinfo=timezone.utc
    )
    unit = match.group("unit").lower()
    duration = int(match.group("count")) * UNIT_MINUTES[unit]
    return Summary(path=path, start=start, end=start + timedelta(minutes=duration), duration_minutes=duration)


def read_summaries(resources: Path) -> list[Summary]:
    if not resources.is_dir():
        return []
    parsed = (parse_summary(path) for path in resources.glob("*-memory-summary.md"))
    return sorted(
        (item for item in parsed if item is not None),
        key=lambda item: (item.start, item.end, str(item.path)),
    )


def select_cover(
    summaries: list[Summary], start: datetime, end: datetime
) -> tuple[list[Summary], list[tuple[datetime, datetime]]]:
    candidates = [item for item in summaries if item.start < end and item.end > start]
    single = [item for item in candidates if item.start <= start and item.end >= end]
    if single:
        return [
            min(
                single,
                key=lambda item: (item.duration_minutes, item.start, str(item.path)),
            )
        ], []

    selected: list[Summary] = []
    gaps: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        available = [item for item in candidates if item.start <= cursor and item.end > cursor]
        if available:
            chosen = max(
                available,
                key=lambda item: (
                    item.end,
                    -item.duration_minutes,
                    -item.start.timestamp(),
                ),
            )
            if chosen not in selected:
                selected.append(chosen)
            cursor = min(chosen.end, end)
            continue
        upcoming = [item.start for item in candidates if item.start > cursor]
        gap_end = min(min(upcoming), end) if upcoming else end
        gaps.append((cursor, gap_end))
        cursor = gap_end
    return sorted(selected, key=lambda item: (item.start, item.end)), gaps


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", required=True, help="ISO-8601 timestamp with Z or UTC offset")
    parser.add_argument("--end", required=True, help="ISO-8601 timestamp with Z or UTC offset")
    parser.add_argument(
        "--resources",
        type=Path,
        default=Path.home() / ".codex/memories/extensions/chronicle/resources",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        start = parse_input_time(args.start)
        end = parse_input_time(args.end)
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    if end <= start:
        print(json.dumps({"error": "end must be later than start"}))
        return 2

    summaries = read_summaries(args.resources)
    selected, gaps = select_cover(summaries, start, end)
    before = [item for item in summaries if item.end <= start]
    after = [item for item in summaries if item.start >= end]
    report = {
        "requested": {"start": iso_z(start), "end": iso_z(end)},
        "resources_directory": str(args.resources),
        "recognized_resources": len(summaries),
        "complete_coverage": not gaps,
        "selected": [item.as_dict() for item in selected],
        "coverage_gaps": [
            {"start": iso_z(left), "end": iso_z(right)} for left, right in gaps
        ],
        "nearest_before": max(before, key=lambda item: item.end).as_dict() if before else None,
        "nearest_after": min(after, key=lambda item: item.start).as_dict() if after else None,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
