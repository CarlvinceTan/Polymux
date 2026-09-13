"""Tests for generic command-driven Control state."""

import importlib.util
import io
import json
import sys
import unittest
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_ROOT / "scripts" / "control.py"
SPEC = importlib.util.spec_from_file_location("control_state", MODULE_PATH)
control = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = control
SPEC.loader.exec_module(control)


def device(command=None):
    return {
        "id": "example-local-device",
        "name": "example-local-device",
        "kind": "local",
        "platform": "linux",
        "user_active": True,
        "command": command,
    }


STATE = {
    "platform": "linux",
    "name": "Example Remote Device",
    "active": "Example Browser / window-1 / Example Page",
    "apps": {
        "Example Browser": {
            "window-1": ["* Example Page | https://example.invalid/"]
        }
    },
}


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patcher = mock.patch.object(control, "runtime_dir", return_value=Path(self.temp.name))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_doctor_uses_setup_safe_reachability_timeout(self):
        args = control.parser().parse_args(["doctor", "--offline"])
        self.assertEqual(args.timeout, 30.0)

    def test_state_includes_warnings_automatically(self):
        args = control.parser().parse_args(["state", "--json", "--fresh"])
        fixture = {"devices": {"local": {"kind": "local", "platform": "linux"}}}
        with mock.patch.object(control, "load_control_config", return_value=fixture), \
             mock.patch.object(control, "command_json", return_value={"_warnings": ["optional_collector_unavailable"]}), \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(args.func(args), 0)
        self.assertIn("optional_collector_unavailable", output.getvalue())

    def test_state_preserves_browser_metadata_without_a_controller(self):
        args = control.parser().parse_args(["state", "--json", "--fresh"])
        fixture = {"devices": {"local": {"kind": "local", "platform": "linux"}}}
        with mock.patch.object(control, "load_control_config", return_value=fixture), \
             mock.patch.object(control, "command_json", return_value={"browsers": [{"name": "Example Browser", "status": "metadata_only"}]}), \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(args.func(args), 0)
        self.assertIn("metadata_only", output.getvalue())

    @mock.patch.object(control, "command_json", return_value={"apps": {}, "surfaces": []})
    def test_local_builtin_when_state_command_is_absent(self, command):
        result = control.collect_device(device(), 1)
        self.assertEqual(result.state["name"], "example-local-device")
        self.assertEqual(result.state["apps"], {})

    @mock.patch.object(control, "command_json", return_value={"apps": {}, "surfaces": []})
    def test_collect_local_reports_local_kind(self, command):
        args = control.parser().parse_args(["collect-local", "--name", "example-local"])
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(args.func(args), 0)
        self.assertIn('"kind": "local"', output.getvalue())

    @mock.patch.object(control, "run_json_command", return_value=STATE)
    def test_generic_state_command(self, run):
        result = control.collect_device(device(["state-helper", "--json"]), 1)
        self.assertEqual(result.state["active"], STATE["active"])
        self.assertEqual(run.call_args.args[0], ["state-helper", "--json"])

    def test_state_commands_are_read_from_control_config(self):
        configured = control.devices_from_config(
            {
                "devices": {
                    "example-local-device": {
                        "kind": "local",
                        "platform": "linux",
                        "user_active": True,
                        "state_command": ["state-helper"],
                    },
                    "server": {"kind": "remote", "platform": "linux"},
                }
            }
        )
        self.assertEqual(len(configured), 2)
        self.assertEqual(configured[0]["command"], ["state-helper"])
        self.assertNotIn("capabilities", configured[0])

    def test_doctor_inventory_includes_agent_owned_devices(self):
        value = {
            "devices": {
                "local": {"kind": "local", "platform": "linux", "user_active": True},
                "server": {"kind": "remote", "platform": "linux", "power": {
                    "status": ["server-status"]
                }},
            }
        }
        ambient = control.devices_from_config(value)
        diagnostic = control.devices_from_config(value, user_active_only=False)
        self.assertEqual([item["id"] for item in ambient], ["local", "server"])
        self.assertEqual([item["id"] for item in diagnostic], ["local", "server"])

    def test_doctor_uses_power_status_as_remote_reachability_probe(self):
        device = {
            "id": "server", "name": "server", "kind": "remote",
            "platform": "linux", "user_active": False, "command": None,
            "power": {"status": ["server-status"], "wake": ["server-wake"]},
        }
        online = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(control, "run_probe", return_value=online) as probe:
            report, failed = control.doctor_device(device, 2)
        self.assertFalse(failed)
        self.assertTrue(report["reachable"])
        self.assertEqual(report["source"], "power.status")
        self.assertEqual(report["power"]["status"], "online")
        self.assertTrue(report["power"]["wake_configured"])
        probe.assert_called_once_with(["server-status"], 2)

    def test_doctor_fails_device_without_any_reachability_route(self):
        device = {
            "id": "phone", "name": "phone", "kind": "phone",
            "platform": "android", "user_active": False, "command": None,
            "power": None,
        }
        report, failed = control.doctor_device(device, 2)
        self.assertTrue(failed)
        self.assertFalse(report["reachable"])
        self.assertIn("no state_command or power.status", report["error"])

    def test_doctor_uses_vm_management_status_for_agent_owned_vm(self):
        device = {
            "id": "example-vm", "name": "example-vm", "kind": "vm",
            "platform": "windows", "user_active": False, "command": None,
            "power": None,
        }
        available = mock.Mock(returncode=0, stdout="VM: shut off\n", stderr="")
        with mock.patch.object(control, "run_probe", return_value=available) as probe:
            report, failed = control.doctor_device(device, 2)
        self.assertFalse(failed)
        self.assertTrue(report["reachable"])
        self.assertEqual(report["source"], "libvirt")
        self.assertIn("scripts/vm/libvirt.py", probe.call_args.args[0][1].replace("\\", "/"))

    def test_rejects_string_state_command(self):
        with self.assertRaisesRegex(control.ControlError, "non-empty string list"):
            control.devices_from_config(
                {
                    "devices": {
                        "example-local-device": {
                            "kind": "local",
                            "platform": "linux",
                            "user_active": True,
                            "state_command": "state-helper",
                        }
                    }
                }
            )

    def test_user_active_must_be_a_top_level_boolean(self):
        with self.assertRaisesRegex(control.ControlError, "user_active must be a boolean"):
            control.devices_from_config(
                {
                    "devices": {
                        "example-local-device": {
                            "kind": "local",
                            "platform": "linux",
                            "user_active": "yes",
                        }
                    }
                }
            )

    def test_user_active_defaults_to_shared(self):
        configured = control.devices_from_config(
            {
                "devices": {
                    "example-device": {
                        "kind": "local",
                        "platform": "linux",
                    }
                }
            }
        )
        self.assertEqual(len(configured), 1)
        self.assertTrue(configured[0]["user_active"])

    def test_non_local_user_active_device_requires_state_command(self):
        remote = device()
        remote["kind"] = "remote"
        result = control.collect_device(remote, 1)
        self.assertEqual(result.state["completeness"], "unavailable")
        self.assertIn("no state collector", result.warnings[0])

    def test_compact_yaml_preserves_tab_marker(self):
        output = control.compact_state([dict(STATE)])
        rendered = "\n".join(control.yaml_lines(output))
        self.assertIn(
            'active: "Example Browser / window-1 / Example Page"', rendered
        )
        self.assertIn(
            '- "* Example Page | https://example.invalid/"', rendered
        )

    def test_yaml_preserves_empty_diagnostic_containers(self):
        rendered = "\n".join(control.yaml_lines({"registrations": [], "details": {}}))
        self.assertEqual(rendered, "registrations: []\ndetails: {}")

    def test_skill_relative_command_resolution(self):
        resolved = control.resolve_command(
            ["scripts/control.py", "--helper", "${skill}/scripts/config.py"]
        )
        self.assertEqual(resolved[0], str(control.SKILL_ROOT / "scripts/control.py"))
        self.assertEqual(Path(resolved[2]), control.SKILL_ROOT / "scripts/config.py")

    def test_missing_configuration_returns_setup_guidance_without_traceback(self):
        output = io.StringIO()
        with mock.patch.object(control, "load_control_config", side_effect=FileNotFoundError()), \
             mock.patch.object(sys, "argv", ["control.py", "state"]), \
             redirect_stdout(output):
            code = control.main()
        self.assertEqual(code, 2)
        self.assertIn('status: "setup_required"', output.getvalue())
        self.assertIn('next: "references/setup.md"', output.getvalue())


if __name__ == "__main__":
    unittest.main()
