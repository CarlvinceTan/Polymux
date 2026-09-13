"""Opt-in macOS LLDB regression using only a disposable process we create."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest


class RealCaptureLifecycle(unittest.TestCase):
    def test_synchronous_daemon_continue_releases_target_and_exits(self):
        self.run_capture(False)

    def test_completed_capture_releases_target_and_exits(self):
        self.run_capture(True)

    def run_capture(self, complete):
        helper = Path(__file__).with_name('wxcdn_fileid_capture.py').resolve()
        with tempfile.TemporaryDirectory(prefix='polymux-capture-test-') as tmp:
            root = Path(tmp)
            source = root / 'target.c'
            source.write_text('#include <unistd.h>\n__attribute__((noinline)) void capture_point(void) { usleep(100000); }\nint main(void) { for (int i=0; i<300; i++) capture_point(); return 0; }\n')
            subprocess.run(['clang', '-g', str(source), '-o', str(root / 'target')], check=True, capture_output=True)
            target = subprocess.Popen([str(root / 'target')])
            debugger = None
            commands = []
            if complete:
                callback = root / 'completion.py'
                callback.write_text(
                    'import wxcdn_fileid_capture as capture\n'
                    'def done(frame, bp, unused):\n'
                    '    capture._detach_capture(frame.GetThread().GetProcess())\n'
                    '    return False\n'
                )
                commands = ['-o', f'command script import {callback}',
                    '-o', 'breakpoint set -n capture_point',
                    '-o', 'breakpoint command add -F completion.done 1']
            try:
                debugger = subprocess.Popen([
                    '/usr/bin/lldb', '--no-lldbinit', '-p', str(target.pid),
                    '-o', 'process handle SIGSTOP -s false -n false -p true',
                    '-o', f'command script import {helper}',
                    *commands, '-o', 'cdn-capture-auto-detach 7', '-o', 'continue',
                ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                # Keep stdin open just like the daemon. communicate() would close
                # it and let EOF hide the idle-debugger regression.
                debugger.wait(timeout=12)
                output = debugger.stdout.read().decode(errors='replace')
                self.assertEqual(debugger.returncode, 0, output)
                time.sleep(0.5)
                os.kill(target.pid, 0)
                state = subprocess.check_output(['ps', '-p', str(target.pid), '-o', 'stat='], text=True).strip()
                self.assertTrue(state, output)
                self.assertFalse(any(flag in state for flag in 'XTZ'), state + '\n' + output)
            finally:
                # Never poll Popen(target) during attachment: debugserver briefly
                # reparents it, and ECHILD can be mistaken for successful exit.
                try:
                    os.kill(target.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                if debugger is not None:
                    if debugger.poll() is None:
                        debugger.kill()
                    debugger.wait(timeout=5)
                    debugger.stdin.close()
                    debugger.stdout.close()
                target.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
