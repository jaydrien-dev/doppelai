# Emits one JSON line whenever the foreground window changes.
# Long-lived: Doppel starts this once and reads its stdout as an event stream.

$ErrorActionPreference = 'SilentlyContinue'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DoppelWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out uint procId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
}
"@

$last = ''

while ($true) {
  $handle = [DoppelWin]::GetForegroundWindow()

  $sb = New-Object System.Text.StringBuilder 1024
  [void][DoppelWin]::GetWindowTextW($handle, $sb, 1024)
  $title = $sb.ToString()

  [uint32]$owner = 0
  [void][DoppelWin]::GetWindowThreadProcessId($handle, [ref]$owner)

  $procName = ''
  if ($owner -gt 0) {
    $p = Get-Process -Id $owner -ErrorAction SilentlyContinue
    if ($p) { $procName = $p.ProcessName }
  }

  $key = "$procName|$title"
  if ($key -ne $last -and $procName -ne '') {
    $last = $key
    $payload = [ordered]@{
      app    = $procName
      title  = $title
      procId = [int]$owner
      at     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($payload)
    [Console]::Out.Flush()
  }

  Start-Sleep -Milliseconds 700
}
