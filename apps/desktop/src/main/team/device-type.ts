import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import type {DeviceType} from '@polymux/protocol';

export function chassisDeviceType(chassis: number): DeviceType {
  if ([30, 32].includes(chassis)) return 'tablet';
  if ([8, 9, 10, 14, 31].includes(chassis)) return 'laptop';
  return 'pc';
}
/** Called by the GUI app; the headless runtime identifies itself as a server. */
export function detectDesktopDeviceType(): DeviceType {
  try {
    if (process.platform === 'darwin') {
      const model = execFileSync('/usr/sbin/sysctl', ['-n', 'hw.model'], {encoding: 'utf8', timeout: 2000});
      if (/MacBook/i.test(model)) return 'laptop';
      // Recent Macs use generic MacXX,Y model IDs; the built-in battery identifies notebooks.
      return /AppleSmartBattery/.test(execFileSync('/usr/sbin/ioreg', ['-r', '-c', 'AppleSmartBattery'], {encoding: 'utf8', timeout: 2000})) ? 'laptop' : 'pc';
    }
    if (process.platform === 'linux') return chassisDeviceType(Number(readFileSync('/sys/class/dmi/id/chassis_type', 'utf8')));
    if (process.platform === 'win32') {
      const chassis = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_SystemEnclosure).ChassisTypes | Select-Object -First 1'], {encoding: 'utf8', timeout: 3000, windowsHide: true});
      return chassisDeviceType(Number(chassis.trim()));
    }
  } catch { /* Hardware information is optional; use the generic PC icon. */ }
  return 'pc';
}
