"""Run control checks with a required synthetic TLS fixture, never real credentials."""
import os
import argparse
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="Run the full Swift suite with the fixture")
    args = parser.parse_args()
    temp = Path(tempfile.gettempdir()) / "opencode"
    with tempfile.TemporaryDirectory(prefix="polymux-control-", dir=temp if temp.is_dir() else None) as directory:
        binary = Path(directory) / "device-fixture"
        subprocess.run(["go", "build", "-o", str(binary), "./tests/device_fixture"],
                       cwd=ROOT / "apps/server", check=True, timeout=120)
        environment = dict(os.environ, POLYMUX_DEVICE_FIXTURE=str(binary))
        command = ["swift", "test"] + ([] if args.all else ["--filter", "PolymuxControlTests"])
        subprocess.run(command,
                       cwd=ROOT, env=environment, check=True, timeout=120)


if __name__ == "__main__":
    main()
