"""Tests for programmatic dialog inspection and safe resolution."""

import importlib.util
import sys
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_ROOT / "scripts" / "dialog.py"
if str(MODULE_PATH.parent) not in sys.path:
    sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("control_dialog", MODULE_PATH)
dialog = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = dialog
SPEC.loader.exec_module(dialog)


def arguments(
    command="resolve",
    button="Cancel",
    match_attribute=None,
    match_value=None,
):
    return Namespace(
        command=command,
        device="shared-device",
        app="Example",
        app_id="example.app",
        pid=123,
        native_window_id=45,
        owner="agent-1",
        button=button,
        match_attribute=match_attribute,
        match_value=match_value,
    )


ACQUIRED = {"status": "acquired", "token": "lock-test"}
RELEASED = {"status": "released"}
VALIDATE_TARGET_IDENTITY = dialog.validate_target_identity


class DialogTests(unittest.TestCase):
    def setUp(self):
        dialog.device_requires_lock = lambda device: device != "agent-owned"
        patcher = mock.patch.object(dialog, "validate_target_identity")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_lock_identity_is_the_controller_window_id(self):
        self.assertEqual(dialog.lock_window_id(45), "45")

    def test_canonical_identity_is_verified_before_locking(self):
        args = arguments()
        listed = {
            "status": "listed",
            "app_id": "different.app",
            "windows": [{"window_id": 45}],
        }
        with mock.patch.object(dialog, "run_json", return_value=(0, listed)) as run_json:
            with self.assertRaisesRegex(dialog.DialogError, "does not match"):
                VALIDATE_TARGET_IDENTITY(args)
        self.assertIn("window.py", " ".join(run_json.call_args.args[0]))
        self.assertNotIn("lock.py", " ".join(run_json.call_args.args[0]))

    def test_transient_identity_discovery_failure_is_retried(self):
        args = arguments()
        unavailable = {"status": "blocked_accessibility_windows_unavailable"}
        listed = {
            "status": "listed",
            "app_id": args.app_id,
            "windows": [{"window_id": args.native_window_id}],
        }
        with mock.patch.object(
            dialog, "run_json", side_effect=[(5, unavailable), (0, listed)]
        ) as run_json, mock.patch.object(dialog.time, "sleep"):
            VALIDATE_TARGET_IDENTITY(args)
        self.assertEqual(run_json.call_count, 2)

    def test_identity_failure_returns_before_locking(self):
        dialog.validate_target_identity.side_effect = dialog.DialogError("identity changed")
        with mock.patch.object(dialog, "run_json") as run_json:
            code, payload = dialog.execute(arguments())
        self.assertEqual(code, 5)
        self.assertEqual(payload["status"], "blocked_unsupported")
        run_json.assert_not_called()

    def test_detected_permission_does_not_block_exact_button(self):
        inspected = {
            "status": "inspected",
            "controls": [
                {"title": "Screen Recording", "actions": []},
                {"title": "Allow", "actions": ["AXPress"]},
            ],
        }
        listed = {"status": "listed", "windows": []}
        with mock.patch.object(
            dialog,
            "run_json",
            side_effect=[
                (0, ACQUIRED),
                (0, inspected),
                (0, {"status": "pressed"}),
                (0, listed),
                (0, RELEASED),
            ],
        ):
            code, payload = dialog.execute(arguments(button="Allow"))
        self.assertEqual(code, 0)
        self.assertEqual(payload["kind"], "permission")
        self.assertEqual(payload["matched"]["value"], "Allow")

    def test_consent_and_destructive_classifications_do_not_block_exact_buttons(self):
        for label, button, expected_kind in (
            ("License Agreement", "I Agree", "consent"),
            ("Delete permanently?", "Delete", "destructive"),
        ):
            with self.subTest(kind=expected_kind):
                inspected = {
                    "status": "inspected",
                    "controls": [
                        {"role": "AXStaticText", "value": label, "actions": []},
                        {"title": button, "actions": ["AXPress"]},
                    ],
                }
                listed = {"status": "listed", "windows": []}
                with mock.patch.object(
                    dialog,
                    "run_json",
                    side_effect=[
                        (0, ACQUIRED),
                        (0, inspected),
                        (0, {"status": "pressed"}),
                        (0, listed),
                        (0, RELEASED),
                    ],
                ):
                    code, payload = dialog.execute(arguments(button=button))
                self.assertEqual(code, 0)
                self.assertEqual(payload["kind"], expected_kind)
                self.assertEqual(payload["matched"]["value"], button)

    def test_cancel_is_pressed_verified_and_released(self):
        inspected = {
            "status": "inspected",
            "controls": [
                {
                    "role": "AXButton",
                    "title": "Cancel",
                    "identifier": "cancel-button",
                    "actions": ["AXPress"],
                }
            ],
        }
        listed = {"status": "listed", "windows": [{"window_id": 99}]}
        with mock.patch.object(
            dialog,
            "run_json",
            side_effect=[
                (0, ACQUIRED),
                (0, inspected),
                (0, {"status": "pressed"}),
                (0, listed),
                (0, RELEASED),
            ],
        ):
            code, payload = dialog.execute(arguments())
        self.assertEqual(code, 0)
        self.assertEqual(payload["status"], "transition_observed")
        self.assertEqual(payload["matched"]["value"], "cancel-button")

    def test_changed_dialog_verifies_button_effect(self):
        inspected = {
            "status": "inspected",
            "controls": [{"title": "Close", "actions": ["AXPress"]}],
        }
        listed = {"status": "listed", "windows": [{"window_id": 45}]}
        updated = {
            "status": "inspected",
            "controls": [{"title": "Finished", "actions": []}],
        }
        with mock.patch.object(
            dialog,
            "run_json",
            side_effect=[
                (0, ACQUIRED),
                (0, inspected),
                (0, {"status": "pressed"}),
                (0, listed),
                (0, updated),
                (0, RELEASED),
            ],
        ):
            code, payload = dialog.execute(arguments(button="Close"))
        self.assertEqual(code, 0)
        self.assertEqual(payload["verification"], "dialog_changed")

    def test_unchanged_dialog_fails_verification(self):
        inspected = {
            "status": "inspected",
            "controls": [{"title": "Continue", "actions": ["AXPress"]}],
        }
        listed = {"status": "listed", "windows": [{"window_id": 45}]}
        with mock.patch.object(dialog, "VERIFICATION_TIMEOUT_SECONDS", 0), mock.patch.object(
            dialog, "run_json", side_effect=[
                (0, ACQUIRED), (0, inspected), (0, {"status": "pressed"}),
                (0, listed), (0, inspected), (0, RELEASED),
            ]
        ):
            code, payload = dialog.execute(arguments(button="Continue"))
        self.assertEqual(code, 6)
        self.assertEqual(payload["reason"], "dialog_unchanged")
        self.assertTrue(payload["action_performed"])

    def test_inspection_omits_control_values(self):
        inspected = {
            "status": "inspected",
            "controls": [{"role": "AXTextField", "title": "Name", "value": "private"}],
        }
        with mock.patch.object(
            dialog,
            "run_json",
            side_effect=[(0, inspected)],
        ):
            code, payload = dialog.execute(arguments(command="inspect", button=None))
        self.assertEqual(code, 0)
        self.assertNotIn("value", payload["controls"][0])

    def test_static_text_value_is_visible_and_classifies_permission(self):
        inspected = {
            "status": "inspected",
            "controls": [
                {"role": "AXStaticText", "value": "Allow access to this folder?"},
                {"role": "AXButton", "title": "Allow", "actions": ["AXPress"]},
            ],
        }
        with mock.patch.object(dialog, "run_json", return_value=(0, inspected)):
            code, payload = dialog.execute(arguments(command="inspect", button=None))
        self.assertEqual(code, 0)
        self.assertEqual(payload["kind"], "permission")
        self.assertEqual(payload["controls"][0]["value"], "Allow access to this folder?")

    def test_unmatched_dialog_is_unclassified(self):
        inspected = {
            "status": "inspected",
            "controls": [{"role": "AXStaticText", "value": "A neutral message"}],
        }
        with mock.patch.object(dialog, "run_json", return_value=(0, inspected)):
            code, payload = dialog.execute(arguments(command="inspect", button=None))
        self.assertEqual(code, 0)
        self.assertEqual(payload["kind"], "unclassified")

    def test_transient_accessibility_gap_after_press_is_retried(self):
        inspected = {
            "status": "inspected",
            "controls": [{"title": "Allow", "actions": ["AXPress"]}],
        }
        listed = {"status": "listed", "windows": [{"window_id": 45}]}
        closed = {"status": "listed", "windows": []}
        with mock.patch.object(dialog, "VERIFICATION_INTERVAL_SECONDS", 0), mock.patch.object(
            dialog, "run_json", side_effect=[
                (0, ACQUIRED), (0, inspected), (0, {"status": "pressed"}),
                (0, listed), (4, {"status": "blocked_accessibility_window_missing"}),
                (0, closed), (0, RELEASED),
            ]
        ):
            code, payload = dialog.execute(arguments(button="Allow"))
        self.assertEqual(code, 0)
        self.assertEqual(payload["verification"], "dialog_closed")

    def test_cannot_complete_is_verified_when_handler_closes_app(self):
        inspected = {
            "status": "inspected",
            "controls": [{"title": "Close", "actions": ["AXPress"]}],
        }
        closed = {"status": "listed", "windows": []}
        with mock.patch.object(
            dialog, "run_json", side_effect=[
                (0, ACQUIRED), (0, inspected),
                (7, {"status": "blocked_action_failed", "ax_error": -25204}),
                (0, closed), (0, RELEASED),
            ]
        ):
            code, payload = dialog.execute(arguments(button="Close"))
        self.assertEqual(code, 0)
        self.assertEqual(payload["verification"], "dialog_closed")

    def test_inspection_returns_pressable_options_separately(self):
        inspected = {
            "status": "inspected",
            "controls": [
                {"role": "AXStaticText", "title": "Continue?", "actions": []},
                {"role": "AXButton", "title": "Cancel", "actions": ["AXPress"]},
                {"role": "AXButton", "title": "Continue", "actions": ["AXPress"]},
            ],
        }
        with mock.patch.object(
            dialog,
            "run_json",
            side_effect=[(0, inspected)],
        ):
            code, payload = dialog.execute(arguments(command="inspect", button=None))
        self.assertEqual(code, 0)
        self.assertEqual([button["title"] for button in payload["buttons"]], ["Cancel", "Continue"])

    def test_agent_owned_device_resolves_without_control_lock(self):
        args = arguments()
        args.device = "agent-owned"
        inspected = {"status": "inspected", "controls": [{"title": "Cancel", "actions": ["AXPress"]}]}
        listed = {"status": "listed", "windows": []}
        with mock.patch.object(
            dialog,
            "run_json",
            side_effect=[(0, inspected), (0, {"status": "pressed"}), (0, listed)],
        ) as run_json:
            code, payload = dialog.execute(args)
        self.assertEqual(code, 0)
        self.assertEqual(payload["status"], "transition_observed")
        self.assertFalse(any("lock.py" in " ".join(call.args[0]) for call in run_json.call_args_list))

    def test_exact_identifier_can_select_any_pressable_button(self):
        controls = [
            {
                "title": "Proceed",
                "identifier": "primary-action",
                "actions": ["AXPress"],
            }
        ]
        args = arguments(
            button=None,
            match_attribute="identifier",
            match_value="primary-action",
        )
        self.assertEqual(dialog.exact_button_match(controls, args), ("identifier", "primary-action"))


if __name__ == "__main__":
    unittest.main()
