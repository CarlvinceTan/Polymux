"""Tests for the shared cached macOS Swift compiler."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_ROOT / "scripts" / "macos" / "compile.py"
SPEC = importlib.util.spec_from_file_location("control_macos_compile", MODULE_PATH)
compiler = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compiler)


class CompileTests(unittest.TestCase):
    def test_matching_bundled_helper_needs_no_toolchain_or_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            source = root / "state.swift"
            source.write_text('print("ok")\n')
            digest = compiler.hashlib.sha256(b"script\0" + source.read_bytes()).hexdigest()
            bundled = root / "bin" / f"control-state-{digest}"
            bundled.parent.mkdir()
            bundled.write_bytes(b"binary")
            bundled.chmod(0o755)
            with mock.patch.object(compiler, "SOURCE_ROOT", root), \
                 mock.patch.object(compiler, "BUNDLED_BIN", bundled.parent), \
                 mock.patch.object(compiler, "CACHE_ROOT", root / "unused-cache"), \
                 mock.patch.object(compiler, "swift_command", side_effect=compiler.SwiftCompileError("no compiler")) as command:
                self.assertEqual(compiler.compile_source(source), bundled)
                command.assert_not_called()
                self.assertFalse((root / "unused-cache").exists())
                (root / ".native-bin").write_text(str(bundled.parent))
                with mock.patch.object(compiler, "BUNDLED_BIN", root / "absent"):
                    self.assertEqual(compiler.compile_source(source), bundled)
                    command.assert_not_called()
                with self.assertRaises(compiler.SwiftCompileError):
                    compiler.compile_source(source, parse_as_library=True)
                source.write_text('print("changed")\n')
                with self.assertRaises(compiler.SwiftCompileError):
                    compiler.compile_source(source)

    def test_compilation_is_cached_by_source_and_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "Example.swift"
            source.write_text("print(\"ok\")\n")
            with mock.patch.object(compiler, "CACHE_ROOT", root / "cache"), \
                 mock.patch.object(compiler, "swift_command", return_value=["/installed/swiftc"]):
                def compile_once(command):
                    output = Path(command[command.index("-o") + 1])
                    output.write_bytes(b"binary")
                    return subprocess.CompletedProcess(command, 0)

                with mock.patch.object(
                    compiler.subprocess, "run", side_effect=compile_once
                ) as run:
                    first = compiler.compile_source(source)
                    second = compiler.compile_source(source)
                    library = compiler.compile_source(source, parse_as_library=True)

            self.assertEqual(first, second)
            self.assertNotEqual(first, library)
            self.assertEqual(run.call_count, 2)

    def test_missing_toolchain_never_invokes_compiler_launcher(self):
        with mock.patch.dict(compiler.os.environ, {}, clear=True), \
             mock.patch.object(compiler.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, stdout="")) as run:
            with self.assertRaisesRegex(compiler.SwiftCompileError, "toolchain unavailable"):
                compiler.swift_command()
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0], ["/usr/bin/xcode-select", "--print-path"])

    def test_selected_but_missing_compiler_never_invokes_launcher(self):
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(compiler.os.environ, {"DEVELOPER_DIR": directory}), \
             mock.patch.object(compiler.subprocess, "run") as run:
            with self.assertRaisesRegex(compiler.SwiftCompileError, "compiler unavailable"):
                compiler.swift_command()
        run.assert_not_called()

    def test_installed_command_line_tools_and_xcode_resolve_directly(self):
        for relative in ("usr/bin/swiftc", "Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"):
            with tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / relative
                target.parent.mkdir(parents=True)
                target.write_text("compiler")
                target.chmod(0o700)
                sdk = Path(directory) / "SDKs/MacOSX.sdk"
                sdk.mkdir(parents=True)
                with mock.patch.dict(compiler.os.environ, {"DEVELOPER_DIR": directory}), \
                     mock.patch.object(compiler.os, "access", return_value=True), \
                     mock.patch.object(compiler.subprocess, "run") as run:
                    self.assertEqual(compiler.swift_command(), [str(target), "-sdk", str(sdk)])
                    run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
