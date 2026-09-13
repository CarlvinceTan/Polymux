import importlib.util
import os
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import patch

lldb = types.ModuleType("lldb")
for i, name in enumerate(["eStateDetached", "eStateExited", "eStateInvalid", "eStateStopped", "eStateCrashed", "eStateSuspended", "eStateRunning"]):
    setattr(lldb, name, i)
sys.modules["lldb"] = lldb
spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("wxcdn_fileid_capture.py"))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)

class Result:
    def Success(self): return True
class Process:
    def __init__(self): self.state = lldb.eStateRunning; self.actions = []
    def GetState(self): return self.state
    def GetProcessID(self): return 42
    def Stop(self): self.actions.append("stop"); self.state = lldb.eStateStopped; return Result()
    def Detach(self): self.actions.append("detach"); self.state = lldb.eStateDetached; return Result()

class CaptureDetachTests(unittest.TestCase):
    def run_monitor(self, duration=10, parent=None):
        capture._detached.clear()
        process = Process()
        watcher = threading.Thread(target=capture._watch_capture,
            args=(process, os.getppid() if parent is None else parent, duration))
        watcher.start()
        try:
            self.assertTrue(capture._detached.wait(2))
            self.assertEqual(process.actions, ["stop", "detach"])
        finally:
            capture._detached.set(); watcher.join(2)
            self.assertFalse(watcher.is_alive())

    def test_deadline_releases_without_a_message_capture(self):
        self.run_monitor(duration=0.03)

    def test_parent_exit_releases_before_debugger_reaping(self):
        self.run_monitor(parent=-1)

    def test_completed_capture_is_not_detached_twice(self):
        capture._detached.clear()
        process = Process()
        self.assertTrue(capture._detach_capture(process))
        self.assertTrue(capture._detach_capture(process))
        self.assertEqual(process.actions, ["stop", "detach"])

    def test_failed_stop_does_not_detach_or_report_release(self):
        capture._detached.clear()
        process = Process()
        with patch.object(process, "Stop") as stop:
            stop.return_value.Success.return_value = False
            self.assertFalse(capture._detach_capture(process))
        self.assertEqual(process.actions, [])
        self.assertFalse(capture._detached.is_set())

    def test_failed_detach_does_not_report_release(self):
        capture._detached.clear()
        process = Process()
        with patch.object(process, "Detach") as detach:
            detach.return_value.Success.return_value = False
            self.assertFalse(capture._detach_capture(process))
        self.assertFalse(capture._detached.is_set())

    def test_invalid_process_is_not_proof_of_release(self):
        capture._detached.clear()
        process = Process()
        process.state = lldb.eStateInvalid
        self.assertFalse(capture._detach_capture(process))
        self.assertFalse(capture._detached.is_set())


    def test_owner_exit_before_continue_never_resumes_capture(self):
        capture._detached.clear()
        process = Process()
        process.state = lldb.eStateStopped
        debugger = unittest.mock.Mock()
        debugger.GetSelectedTarget.return_value.GetProcess.return_value = process
        with patch.object(capture, "_capture_owner", -1), \
                patch.object(capture, "_capture_deadline", capture.time.monotonic() + 55), \
                patch.object(capture.os, "_exit", side_effect=SystemExit(0)):
            with self.assertRaises(SystemExit):
                capture._run_capture(debugger, "", unittest.mock.Mock(), {})
        self.assertEqual(process.actions, ["detach"])
        debugger.SetAsync.assert_called_once_with(True)

    def test_unarmed_command_does_not_continue_or_exit(self):
        debugger = unittest.mock.Mock()
        result = unittest.mock.Mock()
        with patch.object(capture, "_capture_owner", None), \
                patch.object(capture.os, "_exit") as leave:
            capture._run_capture(debugger, "", result, {})
            leave.assert_not_called()
        debugger.GetSelectedTarget.assert_not_called()
        result.SetError.assert_called_once()


if __name__ == "__main__": unittest.main()
