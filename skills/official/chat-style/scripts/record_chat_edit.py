#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


DEFAULT_DIR = Path(os.environ.get("CHAT_STYLE_LOG_DIR", Path.home() / ".midas" / "state" / "chat-style" / "edits"))


def log_dir(args):
    path = Path(args.log_dir) if getattr(args, "log_dir", None) else DEFAULT_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def log_file(base, date=None):
    date = date or datetime.now().strftime("%Y-%m-%d")
    return base / f"{date}.jsonl"


def read_entries(path):
    if not path.exists():
        return []
    entries = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


def content_from_args(args):
    if args.text is not None:
        return args.text
    if args.stdin:
        return sys.stdin.read()
    if args.file:
        return Path(args.file).read_text()
    raise SystemExit("Provide --text, --stdin, or --file.")


def short_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]


def append_entry(base, entry):
    with log_file(base).open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def find_unmatched(base, days=14):
    originals = {}
    matched = set()
    for offset in range(days):
        date = (datetime.now() - timedelta(days=offset)).strftime("%Y-%m-%d")
        for entry in read_entries(log_file(base, date)):
            if entry.get("type") == "original":
                originals[entry["hash"]] = entry
            elif entry.get("type") == "final":
                matched.add(entry["hash"])
    return {h: e for h, e in originals.items() if h not in matched}


def record_original(args):
    base = log_dir(args)
    text = content_from_args(args)
    h = short_hash(text)
    entry = {
        "type": "original",
        "timestamp": datetime.now().isoformat(),
        "hash": h,
        "text": text,
        "context": {
            "person": args.person,
            "platform": args.platform,
            "message_type": args.message_type,
            "notes": args.notes,
        },
    }
    append_entry(base, entry)
    print(h)


def record_final(args):
    base = log_dir(args)
    text = content_from_args(args)
    unmatched = find_unmatched(base)
    h = args.match or (next(reversed(unmatched)) if unmatched else None)
    if not h or h not in unmatched:
        raise SystemExit("No matching original found. Pass --match <hash>.")
    original = unmatched[h]
    entry = {
        "type": "final",
        "timestamp": datetime.now().isoformat(),
        "hash": h,
        "original_text": original["text"],
        "final_text": text,
        "changed": original["text"].strip() != text.strip(),
        "context": original.get("context", {}),
    }
    append_entry(base, entry)
    print(h)


def pending(args):
    base = log_dir(args)
    unmatched = find_unmatched(base)
    for h, entry in unmatched.items():
        ctx = entry.get("context", {})
        preview = entry.get("text", "").replace("\n", " ")[:100]
        print(f"{h}\t{ctx.get('platform') or ''}\t{ctx.get('person') or ''}\t{preview}")


def stats(args):
    base = log_dir(args)
    originals = finals = changed = 0
    for path in sorted(base.glob("*.jsonl")):
        for entry in read_entries(path):
            if entry.get("type") == "original":
                originals += 1
            elif entry.get("type") == "final":
                finals += 1
                changed += 1 if entry.get("changed") else 0
    print(json.dumps({
        "log_dir": str(base),
        "originals": originals,
        "finals": finals,
        "changed": changed,
        "pending": len(find_unmatched(base)),
    }, indent=2))


def build_parser():
    parser = argparse.ArgumentParser(description="Record chat draft/final edit pairs for chat-style.")
    parser.add_argument("--log-dir")
    sub = parser.add_subparsers(required=True)

    original = sub.add_parser("record-original")
    original.add_argument("--text")
    original.add_argument("--stdin", action="store_true")
    original.add_argument("--file")
    original.add_argument("--person")
    original.add_argument("--platform")
    original.add_argument("--message-type")
    original.add_argument("--notes")
    original.set_defaults(func=record_original)

    final = sub.add_parser("record-final")
    final.add_argument("--match")
    final.add_argument("--text")
    final.add_argument("--stdin", action="store_true")
    final.add_argument("--file")
    final.set_defaults(func=record_final)

    sub.add_parser("pending").set_defaults(func=pending)
    sub.add_parser("stats").set_defaults(func=stats)
    return parser


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
