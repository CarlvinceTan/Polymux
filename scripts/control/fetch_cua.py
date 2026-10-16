"""Stage Polymux's pinned runtime without installing or starting Cua Driver."""
import hashlib
import io
from pathlib import Path
import tarfile
import urllib.request

VERSION = "0.34.1"
ARCHIVE = f"cua-driver-rs-{VERSION}-darwin-universal-binary.tar.gz"
SHA256 = "52de49b5046df19245ad02ff9aa89ce9caf69e84988e1d0fac677611dd83e48c"
ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / ".vendor" / "cua"


def main():
    url = f"https://github.com/trycua/cua/releases/download/cua-driver-rs-v{VERSION}/{ARCHIVE}"
    with urllib.request.urlopen(url, timeout=60) as response:
        archive = response.read(150 << 20)
    if hashlib.sha256(archive).hexdigest() != SHA256:
        raise SystemExit("Cua archive checksum mismatch; nothing installed")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
        files = [item for item in source.getmembers() if item.isfile() and Path(item.name).name == "cua-driver"]
        if len(files) != 1 or files[0].size > 250 << 20:
            raise SystemExit("Unexpected Cua archive layout")
        binary = source.extractfile(files[0]).read()
        notices = [item for item in source.getmembers() if item.isfile() and
                   ("LICENSE" in Path(item.name).name.upper() or "NOTICE" in Path(item.name).name.upper())]
        DESTINATION.mkdir(parents=True, exist_ok=True)
        (DESTINATION / "cua-driver").write_bytes(binary)
        (DESTINATION / "cua-driver").chmod(0o755)
        (DESTINATION / "SHA256").write_text(hashlib.sha256(binary).hexdigest() + "\n")
        for index, item in enumerate(notices):
            (DESTINATION / f"notice-{index}-{Path(item.name).name}").write_bytes(source.extractfile(item).read())
    print(f"Staged Cua Driver {VERSION} in {DESTINATION}; no service or permission changes")


if __name__ == "__main__":
    main()
