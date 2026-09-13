"""Bounded UI Automation tab-label reads inside the existing Windows session."""
from pathlib import Path
from transport import command_json
from browser.accessibility import attach


def collect(value):
    return attach(value, lambda apps: command_json(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
         '-Command', Path(__file__).with_suffix('.ps1').read_text(encoding='utf-8')], 2.5, input_value={'apps': apps}))
