#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""No-root iPhone developer tunnel and WebDriverAgent relay for Polymux.

The helper is deliberately a separate process. On macOS it rides Apple's own
``remoted`` tunnel. On Windows and Linux it uses pymobiledevice3's in-process
TCP/IP stack, exposing only WDA on a loopback port for the Electron process.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import ipaddress
import json
import os
import signal
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable

PROTOCOL_VERSION = 1
WDA_PORT = 8100
_TUNNEL_UNDERLAY = "unknown"
_TUNNEL_UNDERLAY_SCOPE = "unknown"

# Packaged builds keep the GPL companion dependencies beside this helper and
# reuse the standalone Python already shipped for local signing.
_BUNDLED_SITE_PACKAGES = Path(__file__).resolve().parent / "site-packages"
if _BUNDLED_SITE_PACKAGES.is_dir():
    sys.path.insert(0, str(_BUNDLED_SITE_PACKAGES))


class PhoneDeviceError(Exception):
    """A concise error safe to show in the Phone UI."""


def _emit(value: dict[str, Any]) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def configure_pairing_home(pairing_directory: str) -> Path:
    """Route every pymobiledevice3 pairing lookup into Polymux's private data."""
    target = Path(pairing_directory).expanduser().resolve()
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    with contextlib.suppress(OSError):
        target.chmod(0o700)

    # These imports must precede every lockdown/remote import: several pmd3
    # modules copy get_home_folder into their own namespace at import time.
    import pymobiledevice3.common as common

    def private_home() -> Path:
        return target

    common._HOMEFOLDER = target  # type: ignore[attr-defined]
    common.get_home_folder = private_home

    import pymobiledevice3.pair_records as pair_records

    pair_records.get_home_folder = private_home
    return target


async def _wireless_provider(serial: str | None) -> tuple[Any, None]:
    global _TUNNEL_UNDERLAY, _TUNNEL_UNDERLAY_SCOPE
    from pymobiledevice3.exceptions import UserspaceTunnelUnavailableError
    from pymobiledevice3.remote.tunnel_service import get_remote_pairing_tunnel_services

    services = await get_remote_pairing_tunnel_services(udid=serial)
    if not services:
        raise UserspaceTunnelUnavailableError(
            "The iPhone was not found over Wi-Fi. Keep it awake and make sure the computer is "
            "on the same local network. School, hotel, and guest Wi-Fi often blocks device-to-"
            "device discovery; use the iPhone's Personal Hotspot or a computer hotspot there."
        )
    selected, *unused = services
    for service in unused:
        await service.close()
    _TUNNEL_UNDERLAY = "remote-pairing"
    try:
        address = ipaddress.ip_address(str(selected.hostname).split("%", 1)[0])
        _TUNNEL_UNDERLAY_SCOPE = "link-local" if address.is_link_local else "network"
    except ValueError:
        _TUNNEL_UNDERLAY_SCOPE = "hostname"
    return selected, None


async def polymux_no_root_provider(
    serial: str | None,
    autopair: bool,
    remotepairing_fallback: bool = True,
) -> tuple[Any, Any | None]:
    global _TUNNEL_UNDERLAY, _TUNNEL_UNDERLAY_SCOPE
    """Prefer USB CoreDeviceProxy, but also support a genuinely unplugged phone.

    Upstream pymobiledevice3 11.3 only falls back to RemotePairing when an old
    iOS device lacks CoreDeviceProxy. It tries usbmux first unconditionally, so
    an iOS 17.4+ phone that is already unplugged never reaches its valid Wi-Fi
    pairing record. This bounded provider adds that missing-device fallback.
    """
    from pymobiledevice3.exceptions import (
        ConnectionFailedToUsbmuxdError,
        DeviceNotFoundError,
        InvalidServiceError,
        NoDeviceConnectedError,
        UserspaceTunnelUnavailableError,
    )
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.remote import tunnel_service

    try:
        lockdown = await create_using_usbmux(serial=serial, autopair=autopair)
    except (
        ConnectionFailedToUsbmuxdError,
        DeviceNotFoundError,
        NoDeviceConnectedError,
        FileNotFoundError,
        ConnectionRefusedError,
    ):
        if not remotepairing_fallback:
            raise UserspaceTunnelUnavailableError("The iPhone is not connected over USB.") from None
        return await _wireless_provider(serial)

    try:
        provider = await tunnel_service.CoreDeviceTunnelProxy.create(lockdown)
        _TUNNEL_UNDERLAY = "usb-coredevice"
        _TUNNEL_UNDERLAY_SCOPE = "usb"
        return provider, lockdown
    except InvalidServiceError:
        await lockdown.close()
        if not remotepairing_fallback:
            raise UserspaceTunnelUnavailableError(
                "This iOS version needs a Wi-Fi RemotePairing tunnel."
            ) from None
        return await _wireless_provider(serial)
    except BaseException:
        await lockdown.close()
        raise


def install_wireless_fallback() -> None:
    """Install the provider only inside this dedicated GPL companion process."""
    import pymobiledevice3.remote.userspace_tunnel as userspace_tunnel

    userspace_tunnel._create_no_root_tunnel_provider = polymux_no_root_provider


async def bootstrap_remote_pairing(udid: str, pairing_directory: str) -> None:
    configure_pairing_home(pairing_directory)
    from pymobiledevice3.exceptions import RemotePairingCompletedError
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.remote.tunnel_service import RemotePairingLockdownService

    lockdown = await create_using_usbmux(
        serial=udid,
        autopair=True,
        connection_type="USB",
        pairing_records_cache_folder=Path(pairing_directory),
    )
    service: Any | None = None
    try:
        service = await RemotePairingLockdownService.create(lockdown)
        try:
            await service.connect(autopair=True)
        except RemotePairingCompletedError:
            # Completion intentionally closes the device-side control channel;
            # the persisted record is already the successful outcome.
            pass
    finally:
        if service is not None:
            await service.close()
        await lockdown.close()


async def discover_wireless(pairing_directory: str, udid: str | None = None) -> None:
    """Report only paired iPhones that answer RemotePairing over the LAN."""
    target = configure_pairing_home(pairing_directory)
    from pymobiledevice3.remote.tunnel_service import get_remote_pairing_tunnel_services

    identifiers = [
        entry.name.removeprefix("remote_").removesuffix(".plist")
        for entry in target.glob("remote_*.plist")
        if entry.is_file()
    ]
    if udid is not None:
        identifiers = [identifier for identifier in identifiers if identifier == udid]

    devices: list[dict[str, str]] = []
    for identifier in sorted(set(identifiers)):
        services: list[Any] = []
        try:
            services = await get_remote_pairing_tunnel_services(
                bonjour_timeout=2.0,
                udid=identifier,
            )
            if services:
                devices.append({"udid": identifier, "transport": "wireless"})
        except (OSError, asyncio.TimeoutError):
            pass
        finally:
            for service in services:
                await service.close()
    _emit({"devices": devices, "protocolVersion": PROTOCOL_VERSION})


async def _open_tunnel(udid: str, transport: str) -> tuple[Any, Any, str]:
    global _TUNNEL_UNDERLAY, _TUNNEL_UNDERLAY_SCOPE
    if transport in {"auto", "native"} and sys.platform == "darwin":
        from pymobiledevice3.remote.native_tunnel import NativeRemotedTunnel

        native = NativeRemotedTunnel(serial=udid)
        try:
            rsd = await native.aopen()
            _TUNNEL_UNDERLAY = "apple-remoted"
            _TUNNEL_UNDERLAY_SCOPE = "managed"
            return native, rsd, "native"
        except BaseException:
            await native.aclose()
            if transport == "native":
                raise

    if transport == "native":
        raise PhoneDeviceError("Apple's native iPhone tunnel is only available on macOS.")

    install_wireless_fallback()
    from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel

    userspace = UserspaceRsdTunnel(serial=udid, autopair=True, remotepairing_fallback=True)
    return userspace, await userspace.aopen(), "userspace"


async def query_app(
    udid: str,
    bundle_id: str,
    pairing_directory: str,
    transport: str,
) -> None:
    configure_pairing_home(pairing_directory)
    tunnel, rsd, route = await _open_tunnel(udid, transport)
    try:
        from pymobiledevice3.services.installation_proxy import InstallationProxyService

        async with InstallationProxyService(rsd) as installation:
            apps = await installation.get_apps(bundle_identifiers=[bundle_id])
        _emit({
            "installed": bundle_id in apps,
            "bundleId": bundle_id,
            "protocolVersion": PROTOCOL_VERSION,
            "transport": route,
            "underlay": _TUNNEL_UNDERLAY,
            "underlayScope": _TUNNEL_UNDERLAY_SCOPE,
        })
    finally:
        await tunnel.aclose()


async def install_app(
    udid: str,
    app_path: str,
    pairing_directory: str,
    transport: str,
) -> None:
    app = Path(app_path).expanduser().resolve()
    if not app.is_dir() or app.suffix != ".app":
        raise PhoneDeviceError("The signed iPhone control app is missing.")
    configure_pairing_home(pairing_directory)
    tunnel, rsd, route = await _open_tunnel(udid, transport)
    try:
        from pymobiledevice3.services.installation_proxy import InstallationProxyService

        async with InstallationProxyService(rsd) as installation:
            await installation.install_from_local(app, developer=True)
        _emit({
            "installed": True,
            "protocolVersion": PROTOCOL_VERSION,
            "transport": route,
            "underlay": _TUNNEL_UNDERLAY,
            "underlayScope": _TUNNEL_UNDERLAY_SCOPE,
        })
    finally:
        await tunnel.aclose()


async def _pump(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(64 * 1024):
            writer.write(data)
            await writer.drain()
    finally:
        with contextlib.suppress(Exception):
            if writer.can_write_eof():
                writer.write_eof()


async def _relay_connection(
    open_connection: Callable[[str, int], Awaitable[tuple[asyncio.StreamReader, asyncio.StreamWriter]]],
    device_host: str,
    local_reader: asyncio.StreamReader,
    local_writer: asyncio.StreamWriter,
) -> None:
    remote_writer: asyncio.StreamWriter | None = None
    try:
        remote_reader, remote_writer = await asyncio.wait_for(
            open_connection(device_host, WDA_PORT), timeout=5.0
        )
        tasks = {
            asyncio.create_task(_pump(local_reader, remote_writer)),
            asyncio.create_task(_pump(remote_reader, local_writer)),
        }
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*done, *pending, return_exceptions=True)
    finally:
        if remote_writer is not None:
            remote_writer.close()
            with contextlib.suppress(Exception):
                await remote_writer.wait_closed()
        local_writer.close()
        with contextlib.suppress(Exception):
            await local_writer.wait_closed()


async def _wda_ready(port: int) -> bool:
    writer: asyncio.StreamWriter | None = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection("127.0.0.1", port), timeout=1.5
        )
        writer.write(
            b"GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
        )
        await writer.drain()
        response = await asyncio.wait_for(reader.read(256 * 1024), timeout=2.0)
        status, _, payload = response.partition(b"\r\n\r\n")
        document = json.loads(payload)
        return b" 200 " in status.partition(b"\r\n")[0] and document.get("value", {}).get("ready") is True
    except (OSError, asyncio.TimeoutError, UnicodeDecodeError, ValueError, AttributeError):
        return False
    finally:
        if writer is not None:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()


async def run_wda(
    udid: str,
    bundle_id: str,
    local_port: int,
    pairing_directory: str,
    transport: str,
) -> None:
    configure_pairing_home(pairing_directory)
    tunnel, rsd, route = await _open_tunnel(udid, transport)
    server: asyncio.AbstractServer | None = None
    test_task: asyncio.Task[None] | None = None
    try:
        device_host = str(rsd.service.address[0])
        open_connection = rsd.open_connection if callable(rsd.open_connection) else asyncio.open_connection

        async def forward(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            try:
                await _relay_connection(open_connection, device_host, reader, writer)
            except Exception:
                writer.close()
                with contextlib.suppress(Exception):
                    await writer.wait_closed()

        server = await asyncio.start_server(forward, "127.0.0.1", local_port)
        actual_port = int(server.sockets[0].getsockname()[1])

        from pymobiledevice3.services.dvt.testmanaged.xcuitest import TestConfig, XCUITestService

        config = await TestConfig.create_for(rsd, bundle_id)
        config.runner_app_env = {"USE_PORT": str(WDA_PORT)}
        test_task = asyncio.create_task(XCUITestService(rsd).run(config), name="polymux-wda")

        deadline = asyncio.get_running_loop().time() + 30.0
        while asyncio.get_running_loop().time() < deadline:
            if test_task.done():
                test_task.result()
            if await _wda_ready(actual_port):
                break
            await asyncio.sleep(0.25)
        else:
            raise PhoneDeviceError("Timed out while starting iPhone control.")

        _emit({
            "ready": True,
            "protocolVersion": PROTOCOL_VERSION,
            "localPort": actual_port,
            "transport": route,
            "underlay": _TUNNEL_UNDERLAY,
            "underlayScope": _TUNNEL_UNDERLAY_SCOPE,
        })

        async def watch_health() -> None:
            failures = 0
            while True:
                await asyncio.sleep(5.0)
                if await _wda_ready(actual_port):
                    failures = 0
                    continue
                failures += 1
                if failures >= 2:
                    raise PhoneDeviceError("The iPhone wireless tunnel became unavailable.")

        stopped = asyncio.Event()
        loop = asyncio.get_running_loop()
        for name in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(NotImplementedError, RuntimeError):
                loop.add_signal_handler(name, stopped.set)
        stop_task = asyncio.create_task(stopped.wait(), name="polymux-stop")
        health_task = asyncio.create_task(watch_health(), name="polymux-health")
        done, _ = await asyncio.wait(
            {test_task, stop_task, health_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if test_task in done:
            test_task.result()
        elif health_task in done:
            health_task.result()
        else:
            test_task.cancel()
        stop_task.cancel()
        health_task.cancel()
        await asyncio.gather(test_task, stop_task, health_task, return_exceptions=True)
    finally:
        if server is not None:
            server.close()
            await server.wait_closed()
        if test_task is not None and not test_task.done():
            test_task.cancel()
            await asyncio.gather(test_task, return_exceptions=True)
        await tunnel.aclose()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="polymux-phone-ios-device")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("ping")

    bootstrap = subcommands.add_parser("bootstrap-remote-pairing")
    bootstrap.add_argument("--udid", required=True)
    bootstrap.add_argument("--pairing-directory", required=True)

    discover = subcommands.add_parser("discover-wireless")
    discover.add_argument("--pairing-directory", required=True)
    discover.add_argument("--udid")

    query = subcommands.add_parser("query-app")
    query.add_argument("--udid", required=True)
    query.add_argument("--bundle-id", required=True)
    query.add_argument("--pairing-directory", required=True)
    query.add_argument("--transport", choices=("auto", "native", "userspace"), default="auto")

    install = subcommands.add_parser("install-app")
    install.add_argument("--udid", required=True)
    install.add_argument("--app", required=True)
    install.add_argument("--pairing-directory", required=True)
    install.add_argument("--transport", choices=("auto", "native", "userspace"), default="auto")

    run = subcommands.add_parser("run-wda")
    run.add_argument("--udid", required=True)
    run.add_argument("--bundle-id", required=True)
    run.add_argument("--local-port", type=int, default=0)
    run.add_argument("--pairing-directory", required=True)
    run.add_argument("--transport", choices=("auto", "native", "userspace"), default="auto")
    return parser


async def _main(args: argparse.Namespace) -> None:
    if args.command == "ping":
        _emit({"ready": True, "protocolVersion": PROTOCOL_VERSION})
        return
    if args.command == "bootstrap-remote-pairing":
        await bootstrap_remote_pairing(args.udid, args.pairing_directory)
        _emit({"ready": True, "protocolVersion": PROTOCOL_VERSION, "paired": True})
        return
    if args.command == "discover-wireless":
        await discover_wireless(args.pairing_directory, args.udid)
        return
    if args.command == "query-app":
        await query_app(args.udid, args.bundle_id, args.pairing_directory, args.transport)
        return
    if args.command == "install-app":
        await install_app(args.udid, args.app, args.pairing_directory, args.transport)
        return
    if not 0 <= args.local_port <= 65535:
        raise PhoneDeviceError("The local iPhone relay port is invalid.")
    await run_wda(
        args.udid,
        args.bundle_id,
        args.local_port,
        args.pairing_directory,
        args.transport,
    )


if __name__ == "__main__":
    try:
        asyncio.run(_main(build_parser().parse_args()))
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        if os.environ.get("POLYMUX_PHONE_DEBUG") == "1":
            raise
        print(str(exc) or exc.__class__.__name__, file=sys.stderr, flush=True)
        raise SystemExit(1) from None
