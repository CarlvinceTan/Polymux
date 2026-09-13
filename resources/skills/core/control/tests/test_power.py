"""Tests for generic command-driven power control."""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_ROOT / "scripts" / "power.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("control_power", MODULE_PATH)
power = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = power
SPEC.loader.exec_module(power)


def configured_device(**power_overrides):
    device_power = {
        "status": ["example-status-command"],
        "wake": ["example-wake-command"],
        "sleep": ["example-sleep-command"],
    }
    device_power.update(power_overrides)
    return {
        "devices": {
            "server": {
                "platform": "linux",
                "power": device_power,
            }
        }
    }


class PowerTests(unittest.TestCase):
    def test_rejects_unknown_device(self):
        with self.assertRaisesRegex(power.PowerError, "unknown device 'missing'"):
            power.device_config({"devices": {}}, "missing")

    def test_rejects_device_without_power_configuration(self):
        with self.assertRaisesRegex(power.PowerError, "devices.server.power"):
            power.device_config({"devices": {"server": {}}}, "server")

    def test_expands_skill_in_action_command(self):
        controller = power.PowerController(configured_device(), "server")
        command = controller.command(
            ["python3", "${skill}/scripts/helper.py"], "power.status"
        )
        self.assertEqual(command[0], "python3")
        self.assertEqual(Path(command[1]), power.SKILL_ROOT / "scripts" / "helper.py")

    def test_rejects_string_command_to_avoid_shell_parsing(self):
        controller = power.PowerController(configured_device(), "server")
        with self.assertRaisesRegex(power.PowerError, "non-empty list"):
            controller.command("ssh server true", "power.status")

    def test_status_runs_full_configured_argv_without_shell(self):
        config = configured_device(
            status=["ssh", "-p", "2222", "example-device", "true"]
        )
        controller = power.PowerController(config, "server")
        with mock.patch.object(power.subprocess, "run") as run:
            run.return_value.returncode = 0
            self.assertTrue(controller.online())
        self.assertEqual(
            run.call_args.args[0],
            ["ssh", "-p", "2222", "example-device", "true"],
        )
        self.assertNotIn("shell", run.call_args.kwargs)

    def test_sleep_checks_the_same_idempotent_wake_command_first(self):
        controller = power.PowerController(configured_device(), "server")
        results = [
            mock.Mock(returncode=0),
            mock.Mock(returncode=0),
            mock.Mock(returncode=0),
        ]
        with mock.patch.object(
            controller, "online", side_effect=[True, False]
        ), mock.patch.object(controller, "emit"), mock.patch.object(
            controller, "run", side_effect=results
        ) as run:
            self.assertEqual(controller.sleep(), 0)
        self.assertEqual(run.call_args_list[0].args[0], ["example-wake-command"])
        self.assertEqual(run.call_args_list[1].args[0], ["example-sleep-command"])

    def test_wake_actively_verifies_configured_command_while_already_online(self):
        controller = power.PowerController(configured_device(), "server")
        with mock.patch.object(
            controller, "online", side_effect=[True, True]
        ), mock.patch.object(
            controller, "run", return_value=mock.Mock(returncode=0)
        ) as run, mock.patch.object(controller, "emit"):
            self.assertEqual(controller.wake(), 0)
        run.assert_called_once_with(["example-wake-command"])

    def test_timeout_is_fixed_in_code(self):
        controller = power.PowerController(configured_device(), "server")
        with mock.patch.object(power.subprocess, "run") as run:
            run.return_value.returncode = 0
            controller.run(["example-command"])
        self.assertEqual(run.call_args.kwargs["timeout"], 60)

    def test_online_reports_timeout_as_probe_failure(self):
        controller = power.PowerController(configured_device(), "server")
        with mock.patch.object(controller, "run", side_effect=power.subprocess.TimeoutExpired([], 1)):
            with self.assertRaisesRegex(power.PowerError, "timed out"):
                controller.online()

    def test_online_distinguishes_offline_from_probe_failure(self):
        controller = power.PowerController(configured_device(), "server")
        offline = mock.Mock(returncode=1, stdout="", stderr="")
        failed = mock.Mock(returncode=255, stdout="", stderr="authentication failed")
        with mock.patch.object(controller, "run", return_value=offline):
            self.assertFalse(controller.online())
        with mock.patch.object(controller, "run", return_value=failed):
            with self.assertRaisesRegex(power.PowerError, "authentication failed"):
                controller.online()


if __name__ == "__main__":
    unittest.main()
