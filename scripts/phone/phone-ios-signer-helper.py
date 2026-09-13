#!/usr/bin/env python3
"""Private JSON-lines helper for Polymux's local iPhone signing flow.

Apple-account passwords and two-factor codes arrive over stdin, never command-line
arguments or environment variables. Only Apple's short-lived session token and the
locally generated signing key are persisted. The process keeps the password in memory
only between the first login request and its 2FA completion request.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import plistlib
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

# Session tokens, provisioning material, and cached anisette identity must be private
# even on machines whose normal umask permits group/world reads.
os.umask(0o077)

PROTOCOL_VERSION = 1
BASE_WDA_BUNDLE_ID = "com.flarehq.polymux.wda.xctrunner"
ANISSETTE_LIBRARIES_URL = "https://anisette.dl.mikealmel.ooo/libs?arch=arm64-v8a"
ANISSETTE_LIBRARIES_SHA256 = "59f6a104ef3df1e6630c85de725072f5a80f26df43c83df8552e0d55dd1ee966"
UNICORN_RELEASE = "2.1.4"
UNICORN_WHEELS = {
    ("win32", "amd64"): (
        "https://files.pythonhosted.org/packages/70/3d/de7be9bd1addabe6d8a1369381f8a080400c349850e978689c5e18287957/unicorn-2.1.4-cp37-abi3-win_amd64.whl",
        "d7107500c64ce5c168fbff6bef9485b5db1350050036f4cea568650cf8bdbdf5",
    ),
    ("linux", "x86_64"): (
        "https://files.pythonhosted.org/packages/e7/df/ded5e3684c2d7600b30cc8a7530277b8cb36644a1a9d34cade7ebb45604c/unicorn-2.1.4-cp37-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
        "9d6e6dea140560de4ebd8446661f7ef84a357d428c14a3ef09dacd306ec8c239",
    ),
}


class PhoneSignerError(Exception):
    """A safe, user-actionable signer error."""


anisette: Any = None
developer: Any = None
gsa: Any = None
paths: Any = None
provision: Any = None
EngineError: Any = None

# Keep Polymux's account, certificate, and private-key state distinct from iPASide.
# In particular, the certificate label is used as the guard that prevents one tool
# from revoking another tool's development certificate when a free account is full.
_pending_password: tuple[str, str] | None = None

_MACOS_ANISETTE_SCRIPT = r"""
ObjC.import("Foundation");

function stringValue(value) {
  if (value === undefined || value === null) return null;
  const unwrapped = ObjC.unwrap(value);
  return unwrapped === undefined || unwrapped === null ? null : String(unwrapped);
}

const aosBundle = $.NSBundle.bundleWithPath(
  "/System/Library/PrivateFrameworks/AOSKit.framework"
);
const authBundle = $.NSBundle.bundleWithPath(
  "/System/Library/PrivateFrameworks/AuthKit.framework"
);
if (!aosBundle.load || !authBundle.load) throw new Error("Apple sign-in frameworks unavailable");

const aosUtilities = $.NSClassFromString("AOSUtilities");
const deviceClass = $.NSClassFromString("AKDevice");
const device = deviceClass && deviceClass.currentDevice;
const otp = aosUtilities && aosUtilities.retrieveOTPHeadersForDSID("-2");
if (!device || !otp) throw new Error("Apple sign-in identity unavailable");

JSON.stringify({
  machineId: stringValue(otp.objectForKey("X-Apple-MD-M")),
  oneTimePassword: stringValue(otp.objectForKey("X-Apple-MD")),
  deviceId: stringValue(device.uniqueDeviceIdentifier),
  serialNumber: stringValue(aosUtilities.machineSerialNumber),
  clientInfo: stringValue(device.serverFriendlyDescription),
  locale: stringValue(device.locale.localeIdentifier),
});
"""


def _signer_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.path.join(
        os.path.expanduser("~"), ".local", "share"
    )
    return Path(base) / "PolymuxPhoneSigner"


def _ensure_unicorn() -> None:
    """Fetch Unicorn directly from PyPI instead of redistributing its GPL core."""
    machine = platform.machine().lower()
    if machine == "x86_64" and sys.platform == "win32":
        machine = "amd64"
    wheel = UNICORN_WHEELS.get((sys.platform, machine))
    if wheel is None:
        raise PhoneSignerError("Local Apple sign-in is not available on this computer yet.")
    target = _signer_data_dir() / "vendor" / f"unicorn-{UNICORN_RELEASE}"
    marker = target / ".complete"
    if not marker.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(wheel[0], headers={"User-Agent": "Polymux/phone-signer"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != wheel[1]:
            raise PhoneSignerError(
                "Apple sign-in support changed unexpectedly. Update Polymux before trying again."
            )
        temporary = Path(tempfile.mkdtemp(prefix="unicorn-", dir=target.parent))
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                archive.extractall(temporary)
            (temporary / ".complete").write_text(UNICORN_RELEASE, encoding="utf-8")
            if target.exists():
                shutil.rmtree(target)
            temporary.rename(target)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    sys.path.insert(0, str(target))


def _native_macos_anisette_headers() -> dict[str, str]:
    """Use Apple's system frameworks on macOS, avoiding emulation entirely."""
    completed = subprocess.run(
        ["/usr/bin/osascript", "-l", "JavaScript", "-e", _MACOS_ANISETTE_SCRIPT],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if completed.returncode != 0:
        raise PhoneSignerError(
            "macOS could not prepare Apple sign-in. Sign in to your Mac and try again."
        )
    try:
        values = json.loads(completed.stdout)
    except (TypeError, ValueError) as exc:
        raise PhoneSignerError("macOS returned invalid Apple sign-in data.") from exc
    required = ("machineId", "oneTimePassword", "deviceId", "clientInfo")
    if not all(isinstance(values.get(key), str) and values[key] for key in required):
        raise PhoneSignerError("macOS did not return complete Apple sign-in data.")

    device_id = values["deviceId"]
    return {
        "X-Apple-I-MD-M": values["machineId"],
        "X-Apple-I-MD": values["oneTimePassword"],
        "X-Apple-I-MD-LU": base64.b64encode(device_id.encode("utf-8")).decode("ascii"),
        "X-Apple-I-MD-RINFO": "84215040",
        "X-Mme-Device-Id": device_id,
        "X-Apple-I-SRL-NO": values.get("serialNumber") or "0",
        "X-MMe-Client-Info": values["clientInfo"],
        "X-Apple-I-Client-Time": datetime.now().astimezone().isoformat(timespec="seconds"),
        "X-Apple-I-TimeZone": anisette.ascii_timezone(),
        "X-Apple-Locale": anisette.ascii_locale(values.get("locale")),
    }


def _load_engine() -> None:
    global anisette, developer, gsa, paths, provision, EngineError
    if provision is not None:
        return
    if sys.platform != "darwin":
        _ensure_unicorn()
    from ipaside_engine import anisette as anisette_module
    from ipaside_engine import developer as developer_module
    from ipaside_engine import gsa as gsa_module
    from ipaside_engine import paths as paths_module
    from ipaside_engine import provision as provision_module
    from ipaside_engine.errors import EngineError as engine_error

    anisette = anisette_module
    developer = developer_module
    gsa = gsa_module
    paths = paths_module
    provision = provision_module
    EngineError = engine_error
    paths.APP_NAME = "PolymuxPhoneSigner"
    provision.CERTIFICATE_MACHINE_NAME = "Polymux Phone"
    if sys.platform == "darwin":
        anisette.get_headers = _native_macos_anisette_headers
    else:
        anisette._download_libs = _verified_anisette_libraries  # type: ignore[attr-defined]


def _verified_anisette_libraries() -> io.BytesIO:
    """Download Apple's portable provisioning libraries with a pinned digest.

    The libraries cannot be redistributed, so they are fetched once on first sign-in.
    Pinning turns a compromised mirror or silent upstream replacement into a safe,
    actionable failure before any downloaded byte reaches the emulator.
    """
    request = urllib.request.Request(
        ANISSETTE_LIBRARIES_URL,
        headers={"User-Agent": "Polymux/phone-signer"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != ANISSETTE_LIBRARIES_SHA256:
        raise PhoneSignerError(
            "Apple sign-in support changed unexpectedly. Update Polymux before trying again."
        )
    return io.BytesIO(data)


def _profile_expiration(profile_path: str) -> str | None:
    """Read ExpirationDate from the XML plist embedded in a mobileprovision."""
    raw = Path(profile_path).read_bytes()
    start = raw.find(b"<?xml")
    end = raw.find(b"</plist>", start)
    if start < 0 or end < 0:
        return None
    value = plistlib.loads(raw[start : end + len(b"</plist>")]).get("ExpirationDate")
    return value.isoformat() if hasattr(value, "isoformat") else None


def _sign_wda(params: dict[str, Any]) -> dict[str, Any]:
    _load_engine()
    source = Path(str(params.get("source") or "")).resolve()
    output = Path(str(params.get("output") or "")).resolve()
    zsign = Path(str(params.get("zsign") or "")).resolve()
    udid = str(params.get("udid") or "").strip()
    device_name = str(params.get("deviceName") or "iPhone").strip() or "iPhone"
    if not source.is_dir() or source.suffix != ".app":
        raise PhoneSignerError("The bundled WebDriverAgent app is missing.")
    if not zsign.is_file():
        raise PhoneSignerError("The bundled iPhone signer is missing.")
    if not udid:
        raise PhoneSignerError("Connect and unlock the iPhone first.")
    if output == source or output.suffix != ".app":
        raise PhoneSignerError("The WebDriverAgent output path was invalid.")

    bundle_id = provision.team_scoped_bundle_id(BASE_WDA_BUNDLE_ID)
    bundle = provision.ensure_signing_assets(
        bundle_id,
        udid,
        app_name="Polymux Phone Control",
        device_name=device_name,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        shutil.rmtree(output)
    command = [
        str(zsign),
        "-2",
        "-f",
        "-q",
        "-k",
        str(bundle["p12_path"]),
        "-p",
        str(bundle["p12_password"]),
        "-m",
        str(bundle["profile_path"]),
        "-b",
        bundle_id,
        "-o",
        str(output),
        str(source),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=120)
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().splitlines()
        suffix = detail[-1] if detail else f"exit {completed.returncode}"
        raise PhoneSignerError(f"WebDriverAgent signing failed: {suffix}")
    return {
        "bundleId": bundle_id,
        "output": str(output),
        "expiresAt": _profile_expiration(str(bundle["profile_path"])),
        "teamId": bundle.get("team_id"),
    }


def _handle(method: str, params: dict[str, Any]) -> Any:
    global _pending_password

    if method == "ping":
        return {"protocolVersion": PROTOCOL_VERSION}
    _load_engine()
    if method == "status":
        status = gsa.status()
        return {
            "authenticated": bool(status.get("authenticated")),
            "email": status.get("email"),
            "team_id": status.get("team_id"),
        }
    if method == "prepareAnisette":
        headers = anisette.get_headers()
        return {"ready": True, "headerCount": len(headers)}
    if method == "beginLogin":
        email = str(params.get("email") or "").strip()
        password = str(params.get("password") or "")
        if not email or not password:
            raise PhoneSignerError("Enter your Apple Account email and password.")
        result = gsa.begin_login(email, password)
        _pending_password = (email, password) if result.get("status") == "2fa_required" else None
        return {
            "status": result.get("status"),
            "method": result.get("method"),
        }
    if method == "complete2fa":
        code = str(params.get("code") or "").strip()
        if _pending_password is None:
            raise PhoneSignerError("Start Apple Account sign-in again.")
        if not code:
            raise PhoneSignerError("Enter the verification code Apple sent to your trusted device.")
        email, password = _pending_password
        try:
            result = gsa.complete_2fa(email, password, code)
            return {"status": result.get("status")}
        finally:
            _pending_password = None
    if method == "logout":
        _pending_password = None
        email = str(params.get("email") or "").strip() or None
        gsa.logout(email)
        return {"status": "signed_out"}
    if method == "signWda":
        return _sign_wda(params)
    raise PhoneSignerError(f"Unknown phone signer operation: {method}")


def _response(request: Any) -> dict[str, Any]:
    request_id = request.get("id") if isinstance(request, dict) else None
    try:
        if not isinstance(request, dict):
            raise PhoneSignerError("The phone signer request was invalid.")
        method = request.get("method")
        params = request.get("params") or {}
        if not isinstance(method, str) or not isinstance(params, dict):
            raise PhoneSignerError("The phone signer request was invalid.")
        return {"id": request_id, "ok": True, "result": _handle(method, params)}
    except Exception as exc:  # noqa: BLE001 - hide tracebacks and secrets from the UI
        expected = (PhoneSignerError,)
        if EngineError is not None:
            expected += (EngineError, developer.DeveloperServicesError, gsa.GsaError)
        if isinstance(exc, expected):
            return {"id": request_id, "ok": False, "error": str(exc)}
        print(f"phone signer internal error: {type(exc).__name__}", file=sys.stderr)
        return {
            "id": request_id,
            "ok": False,
            "error": "The local iPhone signer failed unexpectedly. Restart Polymux and try again.",
        }


def main() -> int:
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            request = None
        print(json.dumps(_response(request), separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
