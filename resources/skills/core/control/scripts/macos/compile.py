"""Compile and cache macOS Swift helpers."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage import runtime_dir


CACHE_ROOT = runtime_dir() / "swift"
# In the packaged resources tree, native/bin sits beside skills. Match the
# source and compilation mode exactly so development edits never use stale code.
SOURCE_ROOT = Path(__file__).resolve().parent
BUNDLED_BIN = SOURCE_ROOT.parents[4] / "native" / "bin"


class SwiftCompileError(RuntimeError):
    pass


def swift_command() -> list[str]:
    """Resolve an installed compiler without invoking the developer-tool launcher."""
    selected = os.environ.get("DEVELOPER_DIR")
    if not selected:
        probe = subprocess.run(["/usr/bin/xcode-select", "--print-path"],
                               capture_output=True, text=True, timeout=2)
        if probe.returncode:
            raise SwiftCompileError("Swift toolchain unavailable; native helper cannot compile")
        selected = probe.stdout.strip()
    directory = Path(selected)
    if not selected or not directory.is_absolute():
        raise SwiftCompileError("selected developer directory is unavailable")
    if directory.suffix == ".app":
        directory = directory / "Contents/Developer"
    for relative in ("usr/bin/swiftc", "Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"):
        candidate = directory / relative
        if candidate.is_file() and os.access(candidate, os.X_OK):
            for sdk_relative in ("SDKs/MacOSX.sdk", "Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"):
                sdk = directory / sdk_relative
                if sdk.is_dir():
                    return [str(candidate), "-sdk", str(sdk)]
            raise SwiftCompileError("macOS SDK unavailable; native helper cannot compile")
    raise SwiftCompileError("Swift compiler unavailable; native helper cannot compile")


def compile_source(source: Path, *, parse_as_library: bool = False) -> Path:
    source = source.resolve()
    if not source.is_file():
        raise SwiftCompileError(f"Swift source not found: {source}")
    mode = b"library\0" if parse_as_library else b"script\0"
    digest = hashlib.sha256(mode + source.read_bytes()).hexdigest()
    name = re.sub(r"[^A-Za-z0-9_.-]", "-", source.stem) or "swift"
    directories = [BUNDLED_BIN]
    try:
        mirrored_bin = Path((SOURCE_ROOT / ".native-bin").read_text().strip())
        if mirrored_bin.is_absolute():
            directories.append(mirrored_bin)
    except FileNotFoundError:
        pass
    if source.parent == SOURCE_ROOT:
        for directory in directories:
            bundled = directory / f"control-{name}-{digest}"
            if bundled.is_file() and os.access(bundled, os.X_OK):
                return bundled
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    binary = CACHE_ROOT / f"{name}-{digest}"
    if binary.is_file() and os.access(binary, os.X_OK):
        return binary

    command = swift_command()
    descriptor, temporary_name = tempfile.mkstemp(prefix=f"{name}.", dir=CACHE_ROOT)
    os.close(descriptor)
    temporary = Path(temporary_name)
    if parse_as_library:
        command.append("-parse-as-library")
    command.extend([str(source), "-o", str(temporary)])
    try:
        result = subprocess.run(command)
        if result.returncode:
            raise SwiftCompileError(f"Swift compilation failed: {source.name}")
        temporary.chmod(0o700)
        os.replace(temporary, binary)
        return binary
    finally:
        temporary.unlink(missing_ok=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parse-as-library", action="store_true")
    parser.add_argument("source", type=Path)
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    arguments = args.arguments[1:] if args.arguments[:1] == ["--"] else args.arguments
    try:
        binary = compile_source(args.source, parse_as_library=args.parse_as_library)
    except (OSError, SwiftCompileError) as exc:
        print(str(exc))
        return 2
    return subprocess.run([str(binary), *arguments]).returncode


if __name__ == "__main__":
    raise SystemExit(main())
