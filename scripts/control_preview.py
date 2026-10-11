"""Build an isolated, owned settings fixture at a Cua-resolvable app path."""
import argparse
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
APP = Path.home() / "Applications" / "LuceControlPreview.app"
BUNDLE = "com.test.luce-control-preview"


def owned():
    if APP.is_symlink():
        return False
    try:
        info = plistlib.loads((APP / "Contents/Info.plist").read_bytes())
        return info.get("CFBundleIdentifier") == BUNDLE and info.get("LuceFixtureOwned") is True
    except (OSError, ValueError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clean", action="store_true")
    args = parser.parse_args()
    if APP.exists() or APP.is_symlink():
        if not owned():
            raise SystemExit(f"Refusing to replace an unowned fixture: {APP}")
        if args.clean:
            shutil.rmtree(APP)
            print(f"Removed owned fixture: {APP}")
            return
        raise SystemExit(f"Fixture already exists. Close it and run this script with --clean first: {APP}")
    if args.clean:
        return
    subprocess.run(["swift", "build", "--target", "LuceControl"], cwd=ROOT, check=True, timeout=120)
    products = Path(subprocess.check_output(["swift", "build", "--show-bin-path"], cwd=ROOT, text=True, timeout=30).strip())
    temp = Path(tempfile.gettempdir()) / "opencode"
    with tempfile.TemporaryDirectory(prefix="luce-preview-", dir=temp if temp.is_dir() else None) as directory:
        bundle = Path(directory) / APP.name
        executable = bundle / "Contents/MacOS/LuceControlPreview"
        executable.parent.mkdir(parents=True)
        sources = [ROOT / "apps/Luce/Sources/Control/ControlCoordinator.swift",
                   ROOT / "apps/Luce/Sources/Control/ControlSettings.swift",
                   ROOT / "apps/Luce/Sources/Views/InputFocus.swift",
                   ROOT / "apps/Luce/Tests/ControlTests/SettingsPreview.swift"]
        subprocess.run(["swiftc", "-swift-version", "6", "-parse-as-library", "-I", str(products),
                        "-L", str(products), "-lLuceControl", *map(str, sources), "-o", str(executable)],
                       cwd=ROOT, check=True, timeout=120)
        info = {"CFBundleIdentifier": BUNDLE, "CFBundleExecutable": executable.name,
                "CFBundlePackageType": "APPL", "LuceFixtureOwned": True}
        (bundle / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
        subprocess.run(["codesign", "--force", "--sign", "-", str(bundle)], check=True, timeout=30)
        APP.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(bundle, APP)
    print(f"Prepared {APP}. Launch {BUNDLE} through Cua MCP; this script never launches it.")


if __name__ == "__main__":
    main()
