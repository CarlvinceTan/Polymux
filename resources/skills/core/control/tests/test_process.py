"""Missing Launch Services dates retain an exact, non-mutating process identity."""
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from macos import process


class ProcessTests(unittest.TestCase):
    def test_missing_launch_date_uses_kernel_birth(self):
        kit = mock.Mock()
        kit.send.side_effect = [123, None]
        with mock.patch.object(process, 'AppKit', return_value=kit), \
             mock.patch.object(process, 'kernel_birth', return_value='42:bsd:100:123456') as birth:
            self.assertEqual(process.application_birth(42), '42:bsd:100:123456')
        birth.assert_called_once_with(42)
        kit.close.assert_called_once()

    def test_existing_launch_identity_is_unchanged(self):
        kit = mock.Mock()
        kit.send.side_effect = [123, 456, 100.123456]
        with mock.patch.object(process, 'AppKit', return_value=kit), \
             mock.patch.object(process, 'kernel_birth') as birth:
            self.assertEqual(process.application_birth(42), '42:100.123456')
        birth.assert_not_called()

    def test_absent_application_has_no_fallback(self):
        kit = mock.Mock()
        kit.send.return_value = None
        with mock.patch.object(process, 'AppKit', return_value=kit), \
             mock.patch.object(process, 'kernel_birth') as birth:
            with self.assertRaisesRegex(ValueError, 'identity unavailable'):
                process.application_birth(42)
        birth.assert_not_called()
        kit.close.assert_called_once()

    @unittest.skipUnless(platform.system() == 'Darwin', 'macOS kernel API')
    def test_swift_and_python_kernel_identity_match_without_a_gui(self):
        from macos.compile import compile_source
        expected = process.kernel_birth(os.getpid())
        self.assertRegex(expected, rf'^{os.getpid()}:bsd:[1-9][0-9]*:[0-9]+$')
        with self.assertRaisesRegex(ValueError, 'identity unavailable'):
            process.kernel_birth(2147483647)
        # Compile just the kernel identity function, not the GUI collector.
        source = (ROOT / 'scripts/macos/state.swift').read_text()
        function = source[source.index('func kernelProcessBirth'):source.index('func attribute')]
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'birth.swift'
            file.write_text('import Darwin\n' + function +
                            '\nprint(kernelProcessBirth(pid_t(CommandLine.arguments[1])!) ?? "unavailable")\n')
            binary = compile_source(file)
            value = subprocess.check_output([str(binary), str(os.getpid())], text=True, timeout=3).strip()
            self.assertEqual(value, expected)
            self.assertEqual(subprocess.check_output([str(binary), '2147483647'], text=True, timeout=3).strip(), 'unavailable')


if __name__ == '__main__':
    unittest.main()
