#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

CACHE_PATH = Path.home() / "Library" / "Application Support" / "codex-tab-context" / "tabs.json"
STOP = {"about", "after", "again", "also", "because", "could", "from", "have", "into", "like", "more", "some", "that", "their", "then", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your"}


def tokens(text):
    return {word for word in re.findall(r"[a-z0-9]{3,}", text.lower()) if word not in STOP}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", default="")
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()
    if not CACHE_PATH.exists():
        print(json.dumps({"available": False, "reason": "cache_missing"}))
        return
    payload = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    query_tokens = tokens(args.query)
    ranked = []
    for tab in payload.get("tabs", []):
        haystack = " ".join((tab.get("title", ""), tab.get("url", ""), tab.get("description", "")))
        overlap = len(query_tokens & tokens(haystack))
        score = overlap * 10 + (2 if tab.get("active") else 0)
        ranked.append((score, tab))
    ranked.sort(key=lambda item: item[0], reverse=True)
    captured = payload.get("captured_at", "")
    age_seconds = None
    try:
        age_seconds = int((datetime.now(timezone.utc) - datetime.fromisoformat(captured.replace("Z", "+00:00"))).total_seconds())
    except Exception:
        pass
    result = {
        "available": True,
        "captured_at": captured,
        "age_seconds": age_seconds,
        "tab_count": len(ranked),
        "tabs": [tab for score, tab in ranked[:max(1, args.limit)] if score > 0 or not query_tokens],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
