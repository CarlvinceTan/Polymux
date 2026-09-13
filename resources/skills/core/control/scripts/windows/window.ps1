$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($null -eq $request -or $request -isnot [pscustomobject]) { throw 'Expected a JSON object' }
  $allowed = @('Command','ProcessId','WindowId','Output','MatchAttribute','MatchValue','NewValue','ExpectedValue')
  if ($request.PSObject.Properties.Name | Where-Object { $_ -notin $allowed }) { throw 'Unknown argument' }
  foreach ($name in @('Command','Output','MatchAttribute','MatchValue','NewValue','ExpectedValue')) {
    $property = $request.PSObject.Properties[$name]
    if ($null -ne $property -and $property.Value -isnot [string]) { throw 'Expected string argument' }
  }
  $Command = [string]$request.Command
  if ($Command -notin @('app-identity','list','capture','inspect','press','set-value')) { throw 'Invalid command' }
  $ProcessId = [int]$request.ProcessId
  if ($ProcessId -le 0) { throw 'Positive process ID required' }
  $WindowId = [long]$request.WindowId
  $Output = [string]$request.Output
  $MatchAttribute = [string]$request.MatchAttribute
  $MatchValue = [string]$request.MatchValue
  $NewValue = [string]$request.NewValue
  $ExpectedValue = [string]$request.ExpectedValue
  $HasExpectedValue = $null -ne $request.PSObject.Properties['ExpectedValue']
  if ($Command -eq 'set-value' -and ($null -eq $request.PSObject.Properties['NewValue'] -or -not $HasExpectedValue)) { throw 'Field values required' }
} catch {
  @{status='blocked_usage';reason=$_.Exception.Message} | ConvertTo-Json -Compress
  exit 2
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ControlNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

function Emit([hashtable]$Value, [int]$Code=0) {
  $Value | ConvertTo-Json -Depth 8 -Compress
  exit $Code
}
function Window-Pid([IntPtr]$Handle) {
  [uint32]$p = 0; [void][ControlNative]::GetWindowThreadProcessId($Handle, [ref]$p); return [int]$p
}
function Window-Row([IntPtr]$Handle) {
  $r = New-Object ControlNative+RECT
  if (-not [ControlNative]::GetWindowRect($Handle, [ref]$r)) { return $null }
  $n = [ControlNative]::GetWindowTextLength($Handle); $s = New-Object Text.StringBuilder ($n + 1)
  [void][ControlNative]::GetWindowText($Handle, $s, $s.Capacity)
  return @{window_id=$Handle.ToInt64(); title=$s.ToString(); onscreen=[ControlNative]::IsWindowVisible($Handle); x=$r.Left; y=$r.Top; width=$r.Right-$r.Left; height=$r.Bottom-$r.Top}
}
function Exact-Window {
  $h = [IntPtr]$WindowId
  if ((Window-Pid $h) -ne $ProcessId) { Emit @{status='blocked_exact_window_missing'} 3 }
  return $h
}
function Controls([IntPtr]$Handle) {
  $root = [Windows.Automation.AutomationElement]::FromHandle($Handle)
  if ($null -eq $root) { Emit @{status='blocked_accessibility_unavailable'} 5 }
  $all = $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  $result = @()
  for ($i=0; $i -lt [Math]::Min($all.Count,500); $i++) {
    $e=$all.Item($i); $c=$e.Current; $actions=@()
    $patternObject=$null; if ($e.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$patternObject)) {$actions+='Invoke'}
    $patternObject=$null; if ($e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$patternObject)) {$actions+='SetValue'}
    $row=@{role=$c.ControlType.ProgrammaticName; title=$c.Name; description=$c.HelpText; identifier=$c.AutomationId; actions=$actions}
    $bounds=$c.BoundingRectangle
    $coordinates=@($bounds.X,$bounds.Y,$bounds.Width,$bounds.Height)
    $finite=-not ($coordinates | Where-Object {[double]::IsInfinity($_) -or [double]::IsNaN($_)})
    if ($finite -and $bounds.Width -ge 0 -and $bounds.Height -ge 0) {
      $row.frame=@{x=$bounds.X;y=$bounds.Y;width=$bounds.Width;height=$bounds.Height}
    }
    if (-not $c.IsPassword) {
      $valuePattern=$null
      if ($e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) { $row.value=$valuePattern.Current.Value }
      else { $row.value=$c.Name }
    }
    $result += [pscustomobject]$row
  }
  return ,$result
}
function Matches($Control) {
  $actual = switch ($MatchAttribute) {'role' {$Control.Current.ControlType.ProgrammaticName}; 'title' {$Control.Current.Name}; 'description' {$Control.Current.HelpText}; 'identifier' {$Control.Current.AutomationId}; default {''}}
  return $actual -ceq $MatchValue
}

try {
  if ($Command -eq 'app-identity') {
    $path=(Get-Process -Id $ProcessId -ErrorAction Stop).Path
    if ([string]::IsNullOrWhiteSpace($path)) { Emit @{status='blocked_app_identity_unavailable'} 3 }
    Emit @{status='identified';app_id=[IO.Path]::GetFullPath($path).ToLowerInvariant()}
  }
  if ($Command -eq 'list') {
    $rows=New-Object Collections.Generic.List[object]
    $callback=[ControlNative+EnumWindowsProc]{param($h,$l) if ((Window-Pid $h) -eq $ProcessId) {$row=Window-Row $h; if ($null -ne $row -and $row.width -ge 80 -and $row.height -ge 60) {$rows.Add($row)}}; return $true}
    [void][ControlNative]::EnumWindows($callback,[IntPtr]::Zero)
    Emit @{status='listed';pid=$ProcessId;windows=$rows}
  }
  $h=Exact-Window
  if ($Command -eq 'capture') {
    $row=Window-Row $h; $bmp=New-Object Drawing.Bitmap $row.width,$row.height
    $g=[Drawing.Graphics]::FromImage($bmp); $hdc=$g.GetHdc()
    try { if (-not [ControlNative]::PrintWindow($h,$hdc,2)) { Emit @{status='blocked_capture_failed'} 6 } }
    finally {$g.ReleaseHdc($hdc);$g.Dispose()}
    $bmp.Save($Output,[Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose()
    Emit @{status='captured';output=$Output;width=$row.width;height=$row.height}
  }
  $controls=Controls $h
  if ($Command -eq 'inspect') { Emit @{status='inspected';window_id=$WindowId;controls=$controls} }
  $root=[Windows.Automation.AutomationElement]::FromHandle($h)
  $all=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
  $matches=@(); for($i=0; $i -lt [Math]::Min($all.Count,500); $i++){if(Matches $all.Item($i)){$matches+=$all.Item($i)}}
  if($matches.Count -ne 1){Emit @{status='blocked_exact_control_match';matches=$matches.Count} 5}
  $target=$matches[0]
  if ($Command -eq 'set-value' -and -not $HasExpectedValue) { Emit @{status='blocked_usage'} 2 }
  if ($HasExpectedValue) {
    $current=$target.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    if ($current.Current.Value -cne $ExpectedValue) { Emit @{status='conflict';reason='control_value_changed';action_performed=$false} 9 }
  }
  if($Command -eq 'press'){$pattern=$target.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern);$pattern.Invoke();$status='pressed'}
  else {$pattern=$target.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern);$pattern.SetValue($NewValue);if($pattern.Current.Value -cne $NewValue){Emit @{status='blocked_verification_failed'} 6};$status='value_set'}
  Emit @{status=$status;window_id=$WindowId}
} catch { Emit @{status='blocked_windows_backend_failed';reason=$_.Exception.Message} 5 }
