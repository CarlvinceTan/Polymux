
"""Tests for the shared Control configuration reader."""

import importlib.util
import json
import os
import shlex
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_ROOT / "scripts" / "config.py"
SPEC = importlib.util.spec_from_file_location("control_config", MODULE_PATH)
config = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = config
SPEC.loader.exec_module(config)


class ConfigTests(unittest.TestCase):
    def test_configuration_path_is_flat_instance_file(self):
        self.assertEqual(config.CONFIG, SKILL_ROOT / "instance" / "control.json")

    def test_current_json(self):
        loaded = config.load_config()
        self.assertIsInstance(loaded.get("devices"), dict)
        self.assertNotIn("browser", loaded)

    def test_first_run_initializer_creates_private_local_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "instance" / "control.json"
            created = config.initialize_local(
                True, path=path, hostname="example-host.local", system="Darwin"
            )
            self.assertEqual(created, json.loads(path.read_text()))
            self.assertEqual(created["devices"], {
                "example-host": {
                    "kind": "local", "platform": "macos", "user_active": True
                }
            })
            if os.name != "nt":
                self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    def test_first_run_initializer_requires_explicit_activity_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "instance" / "control.json"
            with self.assertRaisesRegex(ValueError, "must be a boolean"):
                config.initialize_local(
                    "yes", path=path, hostname="example", system="Linux"
                )
            config.initialize_local(
                False, path=path, hostname="example", system="Windows"
            )
            original = path.read_text()
            with self.assertRaisesRegex(ValueError, "will not overwrite"):
                config.initialize_local(
                    True, path=path, hostname="changed", system="Windows"
                )
            self.assertEqual(path.read_text(), original)

    def test_missing_config_uses_shared_defaults_on_all_platforms(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'missing/control.json'
            for system, platform_name in config.PLATFORM_NAMES.items():
                with mock.patch.object(config, 'CONFIG', path), \
                     mock.patch.object(config.socket, 'gethostname', return_value='example.local'), \
                     mock.patch.object(config.platform, 'system', return_value=system):
                    value = config.load_config()
                self.assertEqual(value['devices'], {'example': {
                    'kind': 'local', 'platform': platform_name, 'user_active': True}})
            self.assertFalse(path.parent.exists())

    def test_existing_invalid_or_unreadable_config_never_falls_back(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'control.json'
            path.write_text('{')
            with mock.patch.object(config, 'CONFIG', path):
                with self.assertRaises(ValueError):
                    config.load_config()
            with mock.patch.object(Path, 'read_text', side_effect=PermissionError('denied')):
                with self.assertRaises(PermissionError):
                    config.load_config()

    def test_each_default_config_is_independent(self):
        first = config.local_defaults(hostname='example', system='Linux')
        first['devices']['example']['user_active'] = False
        self.assertTrue(config.local_defaults(hostname='example', system='Linux')['devices']['example']['user_active'])

    def test_json_object(self):
        parsed = config.parse_config(
            '{"devices":{"example":{"kind":"local","platform":"linux"}}}'
        )
        self.assertEqual(parsed["devices"]["example"]["kind"], "local")

    def test_legacy_browser_field_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unsupported top-level fields: browser"):
            config.parse_config(
                '{"browser":"/example/chromium","devices":{'
                '"example":{"kind":"local","platform":"linux"}}}'
            )

    def test_unknown_top_level_and_device_fields_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "unsupported top-level fields"):
            config.parse_config('{"devices":{},"network":{}}')
        with self.assertRaisesRegex(ValueError, "unsupported fields: capabilities"):
            config.parse_config(
                '{"devices":{"example":{"kind":"local","platform":"linux",'
                '"capabilities":[]}}}'
            )

    def test_json_root_must_be_an_object(self):
        with self.assertRaisesRegex(ValueError, "must contain a JSON object"):
            config.parse_config("[]")

    def test_devices_require_kind_and_platform(self):
        with self.assertRaisesRegex(ValueError, "kind must be one of"):
            config.parse_config('{"devices":{"example":{"platform":"linux"}}}')
        with self.assertRaisesRegex(ValueError, "platform is required"):
            config.parse_config('{"devices":{"example":{"kind":"local"}}}')

    def test_device_kinds_are_bounded(self):
        for kind in ("local", "remote", "vm", "phone"):
            device = {"kind": kind, "platform": "android" if kind == "phone" else "linux"}
            devices = {
                "example-local-device": {"kind": "local", "platform": "linux"},
                "example": device,
            }
            if kind == "local":
                devices.pop("example-local-device")
            if kind == "vm":
                device["host"] = "example-host"
                devices["example-host"] = {
                    "kind": "remote",
                    "platform": "linux",
                }
            parsed = config.parse_config(
                json.dumps({"devices": devices})
            )
            self.assertEqual(parsed["devices"]["example"]["kind"], kind)

    def test_vm_platforms_are_linux_or_windows(self):
        base = {
            "example-local-device": {"kind": "local", "platform": "macos"},
            "guest": {"kind": "vm", "platform": "macos", "host": "example-local-device"},
        }
        with self.assertRaisesRegex(ValueError, "platform for vm must be one of: linux, windows"):
            config.parse_config(json.dumps({"devices": base}))
        with self.assertRaisesRegex(ValueError, "kind must be one of"):
            config.parse_config(
                '{"devices":{"example":{"kind":"computer","platform":"linux"}}}'
            )

    def test_command_and_power_shapes_are_strict(self):
        base = {"kind": "local", "platform": "linux"}
        for field, value in (("state_command", "status"), ("state_command", [])):
            device = {**base, field: value}
            with self.assertRaisesRegex(ValueError, "non-empty string array"):
                config.parse_config(json.dumps({"devices": {"example": device}}))
        config.parse_config(json.dumps({"devices": {"example": {**base, "state_command": ["status"]}}}))
        with self.assertRaisesRegex(ValueError, "unsupported fields: preflight_command"):
            config.parse_config(json.dumps({"devices": {"example": {**base, "power": {
                "status": ["true"], "preflight_command": ["true"]
            }}}}))
        with self.assertRaisesRegex(ValueError, "wake is required"):
            config.parse_config(json.dumps({"devices": {"example": {**base, "power": {
                "status": ["true"], "sleep": ["sleep-device"]
            }}}}))

    def test_all_devices_require_agent_coordination(self):
        value = config.parse_config('{"devices":{'
            '"local":{"kind":"local","platform":"linux"},'
            '"remote":{"kind":"remote","platform":"linux"},'
            '"shared":{"kind":"remote","platform":"linux","user_active":true,'
            '"state_command":["status"]}}}')
        self.assertTrue(config.device_requires_lock("local", value))
        self.assertTrue(config.device_requires_lock("remote", value))
        self.assertTrue(config.device_requires_lock("shared", value))

    def test_exactly_one_local_device_is_required(self):
        with self.assertRaisesRegex(ValueError, "exactly one local"):
            config.parse_config(
                '{"devices":{"example":{"kind":"remote","platform":"linux"}}}'
            )
        with self.assertRaisesRegex(ValueError, "exactly one local"):
            config.parse_config(
                '{"devices":{"one":{"kind":"local","platform":"linux"},'
                '"two":{"kind":"local","platform":"macos"}}}'
            )

    def test_vm_requires_a_configured_local_or_remote_host(self):
        with self.assertRaisesRegex(ValueError, "host is required"):
            config.parse_config(
                '{"devices":{"local":{"kind":"local","platform":"linux"},'
                '"example":{"kind":"vm","platform":"windows"}}}'
            )
        with self.assertRaisesRegex(ValueError, "is not a configured device"):
            config.parse_config(
                '{"devices":{"local":{"kind":"local","platform":"linux"},'
                '"example":{"kind":"vm","platform":"windows","host":"missing"}}}'
            )
        with self.assertRaisesRegex(ValueError, "must be a local or remote"):
            config.parse_config(
                '{"devices":{"local":{"kind":"local","platform":"linux"},'
                '"phone":{"kind":"phone","platform":"android"},'
                '"example":{"kind":"vm","platform":"windows","host":"phone"}}}'
            )

    def test_phone_connection_to_local_is_implicit(self):
        parsed = config.parse_config(
            '{"devices":{"local":{"kind":"local","platform":"linux"},'
            '"phone":{"kind":"phone","platform":"android"}}}'
        )
        self.assertNotIn("host", parsed["devices"]["phone"])
        with self.assertRaisesRegex(ValueError, "host is only valid for a VM"):
            config.parse_config(
                '{"devices":{"local":{"kind":"local","platform":"linux"},'
                '"phone":{"kind":"phone","platform":"android","host":"local"}}}'
            )

    def test_portable_sources_do_not_copy_installation_values(self):
        loaded = config.load_config()
        devices = loaded.get("devices", {})
        markers: set[str] = set()
        for device_id, device in devices.items():
            markers.add(device_id)
            if not isinstance(device, dict):
                continue
            for key in ("name", "domain"):
                value = device.get(key)
                if isinstance(value, str):
                    markers.add(value)
            power = device.get("power")
            if not isinstance(power, dict):
                continue
            for action in power.values():
                if not isinstance(action, list):
                    continue
                for argument in action:
                    if not isinstance(argument, str):
                        continue
                    for token in shlex.split(argument):
                        if device_id.casefold() in token.casefold() or str(Path.home()) in token:
                            markers.add(token)
                            markers.add(Path(token).name)

        markers = {marker.casefold() for marker in markers if len(marker) >= 4}
        portable_files = [SKILL_ROOT / "SKILL.md"]
        for directory in ("references", "scripts", "tests"):
            portable_files.extend(
                path
                for path in (SKILL_ROOT / directory).rglob("*")
                if path.suffix in {".md", ".py", ".swift", ".ps1"}
            )

        copied: list[str] = []
        for path in portable_files:
            text = path.read_text(errors="replace").casefold()
            for marker in markers:
                if marker in text:
                    copied.append(f"{path.relative_to(SKILL_ROOT)}: {marker}")
        self.assertEqual(copied, [], "installation values leaked into portable sources")


if __name__ == "__main__":
    unittest.main()
