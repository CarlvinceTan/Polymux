# Read browser chrome only. No tab selection, focus, Invoke, or page traversal.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$walker = [Windows.Automation.TreeWalker]::ControlViewWalker
$results = @()
foreach ($app in $request.apps) {
  $windows = @()
  foreach ($window in $app.windows) {
    $tabs = @(); $selectedNodes = @(); $addresses = @(); $reason = 'Background tab URLs and inaccessible browser chrome are not exposed by UI Automation'
    try {
      $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$window.window_id)
      if ($root.Current.ProcessId -ne $app.pid) { throw 'Window process changed' }
      $queue = New-Object 'System.Collections.Generic.Queue[object]'
      $queue.Enqueue($root); $visited = 0
      while ($queue.Count -gt 0 -and $visited -lt 1000) {
        $node = $queue.Dequeue(); $visited++
        $current = $node.Current
        # Document content can contain webpage tabs, forms, and sensitive text.
        if ($current.ControlType -eq [Windows.Automation.ControlType]::Document) { continue }
        if ($current.ControlType -eq [Windows.Automation.ControlType]::TabItem) {
          $selected = $null
          try { $selected = $node.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch {}
          $tabs += @{title=$current.Name; selected=$selected; url_status='unavailable'}
          if ($selected -eq $true) { $selectedNodes += $node }
          continue
        }
        # Only the browser's known address control, outside document content.
        if ($current.ControlType -eq [Windows.Automation.ControlType]::Edit -and
            ($current.AutomationId -in @('addressEditBox','urlbar-input','urlbar') -or
             $current.Name -in @('Address and search bar','Search or enter address','Search with Google or enter address'))) {
          try {
            $address = $node.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
            if ($address -match '^(https?://|about:|edge://|chrome://|file://)') { $addresses += $address }
          } catch {}
        }
        $child = $walker.GetFirstChild($node)
        $siblings = 0
        while ($null -ne $child -and $siblings -lt 1000 -and $queue.Count -lt 1000) {
          $queue.Enqueue($child); $siblings++
          $child = $walker.GetNextSibling($child)
        }
      }
      # A changed/ambiguous selection cannot associate an address with a tab.
      if ($addresses.Count -eq 1 -and $selectedNodes.Count -eq 1) {
        try {
          if ($selectedNodes[0].GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) {
            $chosen = @($tabs | Where-Object { $_.selected -eq $true })
            if ($chosen.Count -eq 1) { $chosen[0].url = $addresses[0]; $chosen[0].url_status = 'available' }
          }
        } catch {}
      }
      if ($queue.Count -gt 0) { $reason = 'Browser chrome traversal limit reached; background URLs are unavailable' }
      if ($root.Current.ProcessId -ne $app.pid) { throw 'Window process changed' }
    } catch { $reason = $_.Exception.Message }
    $windows += @{window_id=[string]$window.window_id; tabs=@($tabs); reason=$reason}
  }
  $results += @{app_id=$app.app_id; instance_id=$app.instance_id; windows=@($windows)}
}
@{apps=@($results)} | ConvertTo-Json -Depth 10 -Compress
