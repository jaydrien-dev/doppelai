# Executes one batch of input actions and reports what happened.
# Short-lived: Mimic spawns this per step, passing a JSON file of actions.
#
#   [{ "kind": "activate", "match": "Excel" },
#    { "kind": "hotkey",   "keys": "^s" },
#    { "kind": "type",     "text": "hello" },
#    { "kind": "click",    "x": 400, "y": 300 },
#    { "kind": "scroll",   "x": 400, "y": 300, "direction": "down", "amount": 3 },
#    { "kind": "drag",     "x1": 10, "y1": 10, "x2": 200, "y2": 200 },
#    { "kind": "wait",     "ms": 250 }]

param([Parameter(Mandatory = $true)][string]$Plan)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class MimicAct {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out uint procId);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  private delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr p);

  public class Win { public IntPtr Handle; public string Title; public uint ProcId; }

  public static List<Win> Windows() {
    var found = new List<Win>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(1024);
      GetWindowTextW(h, sb, 1024);
      var title = sb.ToString();
      if (title.Length == 0) return true;
      uint procId = 0;
      GetWindowThreadProcessId(h, out procId);
      found.Add(new Win { Handle = h, Title = title, ProcId = procId });
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$LEFT_DOWN = 0x0002
$LEFT_UP = 0x0004
$RIGHT_DOWN = 0x0008
$RIGHT_UP = 0x0010
$MIDDLE_DOWN = 0x0020
$MIDDLE_UP = 0x0040
$WHEEL = 0x0800
$HWHEEL = 0x01000
$SW_RESTORE = 9

function Escape-SendKeys([string]$text) {
  $out = $text
  foreach ($ch in @('{', '}', '(', ')', '+', '^', '%', '~', '[', ']')) {
    $out = $out.Replace($ch, '{' + $ch + '}')
  }
  return $out
}

function Move-To([int]$x, [int]$y) {
  [void][MimicAct]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 40
}

$actions = Get-Content -Raw -Path $Plan | ConvertFrom-Json
if ($actions -isnot [System.Array]) { $actions = @($actions) }

$results = @()

foreach ($action in $actions) {
  $entry = [ordered]@{ kind = $action.kind; ok = $true; detail = '' }

  try {
    switch ($action.kind) {

      'activate' {
        $needle = [string]$action.match
        $target = [MimicAct]::Windows() |
          Where-Object { $_.Title -like "*$needle*" } |
          Select-Object -First 1
        if (-not $target) { throw "No open window matching '$needle'" }
        [void][MimicAct]::ShowWindow($target.Handle, $SW_RESTORE)
        [void][MimicAct]::SetForegroundWindow($target.Handle)
        Start-Sleep -Milliseconds 220
        $entry.detail = $target.Title
      }

      'move' {
        Move-To ([int]$action.x) ([int]$action.y)
        $entry.detail = "$($action.x),$($action.y)"
      }

      'click' {
        Move-To ([int]$action.x) ([int]$action.y)
        $down = $LEFT_DOWN; $up = $LEFT_UP
        if ($action.button -eq 'right') { $down = $RIGHT_DOWN; $up = $RIGHT_UP }
        elseif ($action.button -eq 'middle') { $down = $MIDDLE_DOWN; $up = $MIDDLE_UP }

        $times = 1
        if ($action.double) { $times = 2 }
        if ($action.triple) { $times = 3 }

        for ($i = 0; $i -lt $times; $i++) {
          [MimicAct]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
          [MimicAct]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
          if ($i -lt $times - 1) { Start-Sleep -Milliseconds 60 }
        }
        $button = 'left'
        if ($action.button) { $button = [string]$action.button }
        $entry.detail = "$button x$times at $($action.x),$($action.y)"
      }

      'mouse-down' {
        Move-To ([int]$action.x) ([int]$action.y)
        [MimicAct]::mouse_event($LEFT_DOWN, 0, 0, 0, [IntPtr]::Zero)
        $entry.detail = "down at $($action.x),$($action.y)"
      }

      'mouse-up' {
        if ($null -ne $action.x) { Move-To ([int]$action.x) ([int]$action.y) }
        [MimicAct]::mouse_event($LEFT_UP, 0, 0, 0, [IntPtr]::Zero)
        $entry.detail = 'up'
      }

      'drag' {
        Move-To ([int]$action.x1) ([int]$action.y1)
        [MimicAct]::mouse_event($LEFT_DOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 80
        # Move in steps so the target application sees a real drag, not a jump.
        $steps = 12
        for ($i = 1; $i -le $steps; $i++) {
          $x = [int]($action.x1 + (($action.x2 - $action.x1) * $i / $steps))
          $y = [int]($action.y1 + (($action.y2 - $action.y1) * $i / $steps))
          [void][MimicAct]::SetCursorPos($x, $y)
          Start-Sleep -Milliseconds 16
        }
        Start-Sleep -Milliseconds 80
        [MimicAct]::mouse_event($LEFT_UP, 0, 0, 0, [IntPtr]::Zero)
        $entry.detail = "$($action.x1),$($action.y1) -> $($action.x2),$($action.y2)"
      }

      'scroll' {
        if ($null -ne $action.x) { Move-To ([int]$action.x) ([int]$action.y) }
        $amount = 3
        if ($action.amount) { $amount = [int]$action.amount }
        $dir = [string]$action.direction
        for ($i = 0; $i -lt $amount; $i++) {
          switch ($dir) {
            'up'    { [MimicAct]::mouse_event($WHEEL, 0, 0, 120, [IntPtr]::Zero) }
            'down'  { [MimicAct]::mouse_event($WHEEL, 0, 0, [uint32]4294967176, [IntPtr]::Zero) }
            'right' { [MimicAct]::mouse_event($HWHEEL, 0, 0, 120, [IntPtr]::Zero) }
            'left'  { [MimicAct]::mouse_event($HWHEEL, 0, 0, [uint32]4294967176, [IntPtr]::Zero) }
            default { throw "Unknown scroll direction '$dir'" }
          }
          Start-Sleep -Milliseconds 40
        }
        $entry.detail = "$dir x$amount"
      }

      'type' {
        # SendKeys struggles with very long strings; send it in chunks.
        $text = [string]$action.text
        $chunk = 180
        for ($i = 0; $i -lt $text.Length; $i += $chunk) {
          $part = $text.Substring($i, [Math]::Min($chunk, $text.Length - $i))
          [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeys $part))
          Start-Sleep -Milliseconds 30
        }
        $entry.detail = "$($text.Length) characters"
      }

      'hotkey' {
        # Already in SendKeys notation: ^s, %{F4}, +{TAB}
        [System.Windows.Forms.SendKeys]::SendWait([string]$action.keys)
        $entry.detail = [string]$action.keys
      }

      'hold-key' {
        $ms = if ($action.ms) { [int]$action.ms } else { 500 }
        # SendKeys can't hold a key down; repeat it for the duration instead.
        $deadline = (Get-Date).AddMilliseconds($ms)
        while ((Get-Date) -lt $deadline) {
          [System.Windows.Forms.SendKeys]::SendWait([string]$action.keys)
          Start-Sleep -Milliseconds 40
        }
        $entry.detail = "$($action.keys) for $ms ms"
      }

      'cursor-pos' {
        $p = New-Object 'MimicAct+POINT'
        [void][MimicAct]::GetCursorPos([ref]$p)
        $entry.detail = [ordered]@{ x = $p.X; y = $p.Y }
      }

      'screen-size' {
        $entry.detail = [ordered]@{
          width  = [MimicAct]::GetSystemMetrics(0)
          height = [MimicAct]::GetSystemMetrics(1)
        }
      }

      'wait' {
        $ms = if ($action.ms) { [int]$action.ms } else { 300 }
        Start-Sleep -Milliseconds $ms
        $entry.detail = "$ms ms"
      }

      'list-windows' {
        $entry.detail = [MimicAct]::Windows() |
          ForEach-Object { [ordered]@{ title = $_.Title; procId = [int]$_.ProcId } }
      }

      default { throw "Unknown action '$($action.kind)'" }
    }
  } catch {
    $entry.ok = $false
    $entry.detail = $_.Exception.Message
  }

  $results += $entry
  if (-not $entry.ok) { break }
  Start-Sleep -Milliseconds 90
}

[Console]::Out.WriteLine(($results | ConvertTo-Json -Depth 6 -Compress))
