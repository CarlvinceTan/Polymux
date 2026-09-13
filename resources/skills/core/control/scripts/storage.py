"""Per-user coordination shared by every Control installation on this host."""
import os
import platform
from pathlib import Path


def runtime_dir():
    override = os.environ.get("CONTROL_RUNTIME_DIR")
    if override:
        path = Path(override).expanduser()
        if not path.is_absolute():
            raise ValueError("CONTROL_RUNTIME_DIR must be absolute")
    elif platform.system() == "Darwin":
        path = Path.home() / "Library/Application Support/Control"
    elif platform.system() == "Windows":
        path = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "Control"
    else:
        path = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "control"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path
