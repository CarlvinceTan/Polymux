
"""Tests for libvirt framebuffer/keyboard and QMP pointer helpers."""

import importlib.util
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_ROOT / "scripts" / "vm" / "libvirt.py"
SPEC = importlib.util.spec_from_file_location("control_libvirt", MODULE_PATH)
libvirt = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = libvirt
SPEC.loader.exec_module(libvirt)

import config
from vm import mutex, qga


def write_png_header(path: Path, width: int, height: int) -> None:
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0\0\0\rIHDR" + struct.pack(">II", width, height))


class VmInputTests(unittest.TestCase):
    def test_user_active_vm_mutation_acquires_and_releases_guest_mutex(self):
        with mock.patch.object(mutex, "device_requires_lock", return_value=True), \
             mock.patch.object(mutex, "lock_command", side_effect=[{"token": "token"}, {"lock": {"operation": "op"}}, {}, {}]) as lock:
            with mutex.mutation_mutex("guest", "domain", "agent-1"):
                pass
        self.assertEqual(lock.call_args_list[0].args[:3], ("acquire", "guest", "domain"))
        self.assertEqual(lock.call_args_list[0].kwargs["ttl_seconds"], 300)
        self.assertEqual([c.args[0] for c in lock.call_args_list], ["acquire", "begin", "finish", "release"])

    def test_vm_mutation_uses_requested_mutex_lifetime(self):
        with mock.patch.object(mutex, "device_requires_lock", return_value=True), \
             mock.patch.object(mutex, "lock_command", side_effect=[{"token": "token"}, {"lock": {"operation": "op"}}, {}, {}]) as lock:
            with mutex.mutation_mutex("guest", "domain", "agent-1", ttl_seconds=900):
                pass
        self.assertEqual(lock.call_args_list[0].kwargs["ttl_seconds"], 900)

    def test_qga_mutex_lifetime_covers_requested_timeout(self):
        self.assertEqual(qga.mutation_ttl(120), 300)
        self.assertEqual(qga.mutation_ttl(600), 720)

    def test_qga_backend_calls_are_bounded(self):
        completed = SimpleNamespace(returncode=0, stdout="{}", stderr="")
        with mock.patch.object(qga.subprocess, "run", return_value=completed) as run:
            qga.run_local_or_ssh(None, ["virsh", "example"])
        self.assertEqual(run.call_args.kwargs["timeout"], qga.BACKEND_TIMEOUT_SECONDS)

    def test_user_active_vm_mutation_requires_owner(self):
        with mock.patch.object(mutex, "device_requires_lock", return_value=True):
            with self.assertRaisesRegex(ValueError, "requires --owner"):
                with mutex.mutation_mutex("guest", "domain", None):
                    pass

    def test_vm_device_id_is_domain_and_host_is_resolved_from_config(self):
        configured = {
            "devices": {
                "local-device": {"kind": "local", "platform": "macos"},
                "example-host": {"kind": "remote", "platform": "linux"},
                "example-guest": {
                    "kind": "vm",
                    "platform": "windows",
                    "host": "example-host",
                },
            }
        }
        with mock.patch.object(config, "load_config", return_value=configured):
            self.assertEqual(
                config.resolve_vm_device("example-guest"),
                ("example-host", "example-guest"),
            )

    def test_vm_on_local_host_does_not_use_ssh(self):
        configured = {
            "devices": {
                "local-device": {"kind": "local", "platform": "linux"},
                "example-guest": {
                    "kind": "vm",
                    "platform": "windows",
                    "host": "local-device",
                },
            }
        }
        with mock.patch.object(config, "load_config", return_value=configured):
            self.assertEqual(
                config.resolve_vm_device("example-guest"),
                (None, "example-guest"),
            )

    def test_qmp_uses_structured_monitor_command(self):
        control = libvirt.VmControl("host", "domain")
        control.virsh = mock.Mock(
            return_value=SimpleNamespace(returncode=0, stdout='{"return":{}}', stderr="")
        )
        self.assertEqual(control.qmp({"execute": "query-status"}), {})
        args = control.virsh.call_args.args
        self.assertEqual(args[:3], ("qemu-monitor-command", "domain", "--pretty"))
        self.assertEqual(json.loads(args[3]), {"execute": "query-status"})

    def test_png_dimensions_and_coordinate_scaling(self):
        with tempfile.TemporaryDirectory() as temporary:
            frame = Path(temporary) / "frame.png"
            write_png_header(frame, 1920, 1080)
            self.assertEqual(libvirt.png_dimensions(frame), (1920, 1080))
        self.assertEqual(libvirt.absolute_coordinate(0, 1920), 0)
        self.assertEqual(libvirt.absolute_coordinate(1919, 1920), 0x7FFF)

    def test_click_uses_frame_geometry_and_releases_button(self):
        with tempfile.TemporaryDirectory() as temporary:
            frame = Path(temporary) / "frame.png"
            write_png_header(frame, 101, 101)
            control = libvirt.VmControl("host", "domain")
            control.qmp = mock.Mock(
                side_effect=[[{"current": True, "absolute": True}], {}, {}, {}]
            )
            with mock.patch.object(libvirt.time, "sleep"), mock.patch(
                "sys.stdout", io.StringIO()
            ):
                self.assertEqual(control.click(frame, 50, 25, "left"), 0)
            payloads = [call.args[0] for call in control.qmp.call_args_list]
            move = payloads[1]["arguments"]["events"]
            self.assertEqual(move[0]["data"]["value"], round(0x7FFF / 2))
            self.assertEqual(move[1]["data"]["value"], round(0x7FFF / 4))
            self.assertTrue(payloads[2]["arguments"]["events"][0]["data"]["down"])
            self.assertFalse(payloads[3]["arguments"]["events"][0]["data"]["down"])

    def test_screenshot_returns_verified_png_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "frame.png"
            control = libvirt.VmControl("host", "domain")
            control.qmp = mock.Mock(return_value={})
            control.virsh = mock.Mock(
                return_value=SimpleNamespace(returncode=0, stdout="image/png\n", stderr="")
            )
            commands = []

            def run(command, **_kwargs):
                commands.append(command)
                if command[0] == "scp":
                    write_png_header(output, 1280, 720)
                return SimpleNamespace(returncode=0)

            stream = io.StringIO()
            with mock.patch.object(libvirt.subprocess, "run", side_effect=run), mock.patch(
                "sys.stdout", stream
            ):
                self.assertEqual(control.screenshot(output), 0)
            self.assertEqual(
                json.loads(stream.getvalue()),
                {"path": str(output.resolve()), "width": 1280, "height": 720},
            )
            control.qmp.assert_not_called()
            screenshot_args = control.virsh.call_args.args
            self.assertEqual(screenshot_args[:2], ("screenshot", "domain"))
            self.assertRegex(
                screenshot_args[2],
                r"^/tmp/control-domain-screenshot-[0-9a-f]{16}\.png$",
            )
            self.assertEqual(screenshot_args[3:], ("--screen", "0"))
            self.assertTrue(control.virsh.call_args.kwargs["capture"])
            self.assertEqual(commands[0][0], "scp")
            self.assertEqual(commands[1][0], "ssh")
            self.assertIn(screenshot_args[2], commands[1][-1])

    def test_screenshot_does_not_fall_back_to_qmp(self):
        control = libvirt.VmControl("host", "domain")
        control.qmp = mock.Mock(return_value={})
        control.virsh = mock.Mock(
            return_value=SimpleNamespace(
                returncode=1,
                stdout="",
                stderr="capture unavailable",
            )
        )
        with mock.patch.object(libvirt.subprocess, "run"):
            with self.assertRaisesRegex(RuntimeError, "capture unavailable"):
                control.screenshot(Path("frame.png"))
        control.qmp.assert_not_called()

    def test_click_refuses_relative_pointer(self):
        control = libvirt.VmControl("host", "domain")
        control.qmp = mock.Mock(return_value=[{"current": True, "absolute": False}])
        with self.assertRaisesRegex(RuntimeError, "absolute pointer"):
            control.require_absolute_pointer()

    def test_key_uses_libvirt_send_key_without_qmp(self):
        control = libvirt.VmControl("host", "domain")
        control.qmp = mock.Mock(return_value={})
        control.virsh = mock.Mock(
            return_value=SimpleNamespace(returncode=0, stdout="", stderr="")
        )
        with mock.patch("sys.stdout", io.StringIO()):
            self.assertEqual(control.key(["CTRL", "alt", "delete"], 120), 0)
        control.qmp.assert_not_called()
        self.assertEqual(
            control.virsh.call_args.args,
            (
                "send-key",
                "domain",
                "--codeset",
                "linux",
                "--holdtime",
                "120",
                "KEY_LEFTCTRL",
                "KEY_LEFTALT",
                "KEY_DELETE",
            ),
        )
        self.assertTrue(control.virsh.call_args.kwargs["capture"])

    def test_key_names_cover_letters_functions_and_linux_symbols(self):
        self.assertEqual(libvirt.linux_key_name("a"), "KEY_A")
        self.assertEqual(libvirt.linux_key_name("F12"), "KEY_F12")
        self.assertEqual(libvirt.linux_key_name("KEY_VOLUMEUP"), "KEY_VOLUMEUP")
        with self.assertRaisesRegex(ValueError, "unsupported key"):
            libvirt.linux_key_name("not a key")

    def test_key_failure_does_not_fall_back_to_qmp(self):
        control = libvirt.VmControl("host", "domain")
        control.qmp = mock.Mock(return_value={})
        control.virsh = mock.Mock(
            return_value=SimpleNamespace(
                returncode=1,
                stdout="",
                stderr="keyboard unavailable",
            )
        )
        with self.assertRaisesRegex(RuntimeError, "keyboard unavailable"):
            control.key(["enter"], 100)
        control.qmp.assert_not_called()


if __name__ == "__main__":
    unittest.main()
