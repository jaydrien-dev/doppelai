# Prompts Windows Hello (face, fingerprint, PIN) for identity verification.
# Returns JSON: { "ok": true/false, "method": "biometric"|"pin"|"none", "detail": "..." }
#
# Uses the UWP UserConsentVerifier API — works on any Windows 10+ machine
# with Windows Hello configured. Falls back gracefully if unavailable.

$ErrorActionPreference = 'Stop'

# Load the WinRT type for UserConsentVerifier.
try {
  Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'

  # Helper to await WinRT async operations from PowerShell.
  function Await-Task {
    param([object]$Task)
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
      } |
      Select-Object -First 1
    ).MakeGenericMethod($Task.GetType().GetInterfaces()[0].GenericTypeArguments[0])
    $netTask = $asTask.Invoke($null, @($Task))
    $netTask.Wait()
    return $netTask.Result
  }

  # Load the UserConsentVerifier class.
  [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime] | Out-Null

  # Step 1: Check availability.
  $checkOp = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
  $availability = Await-Task $checkOp

  if ($availability -ne [Windows.Security.Credentials.UI.UserConsentVerifierAvailability]::Available) {
    $detail = switch ($availability) {
      'DeviceNotPresent'  { 'No biometric hardware found.' }
      'NotConfiguredForUser' { 'Windows Hello is not set up for this user.' }
      'DisabledByPolicy'  { 'Windows Hello is disabled by policy.' }
      'DeviceBusy'        { 'Biometric device is busy.' }
      default             { "Windows Hello unavailable: $availability" }
    }
    [Console]::Out.WriteLine((@{ ok = $false; method = 'none'; detail = $detail; available = $false } | ConvertTo-Json -Compress))
    exit 0
  }

  # Step 2: Prompt the user.
  $message = 'Doppel wants to confirm your identity.'
  $verifyOp = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($message)
  $result = Await-Task $verifyOp

  switch ($result) {
    'Verified' {
      [Console]::Out.WriteLine((@{ ok = $true; method = 'biometric'; detail = 'Verified.'; available = $true } | ConvertTo-Json -Compress))
    }
    'Canceled' {
      [Console]::Out.WriteLine((@{ ok = $false; method = 'none'; detail = 'Verification was canceled.'; available = $true } | ConvertTo-Json -Compress))
    }
    'RetriesExhausted' {
      [Console]::Out.WriteLine((@{ ok = $false; method = 'none'; detail = 'Too many failed attempts.'; available = $true } | ConvertTo-Json -Compress))
    }
    default {
      [Console]::Out.WriteLine((@{ ok = $false; method = 'none'; detail = "Verification failed: $result"; available = $true } | ConvertTo-Json -Compress))
    }
  }

} catch {
  [Console]::Out.WriteLine((@{ ok = $false; method = 'none'; detail = $_.Exception.Message; available = $false } | ConvertTo-Json -Compress))
}
