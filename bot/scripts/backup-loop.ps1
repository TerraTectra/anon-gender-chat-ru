$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\TerraTectraBackupLoop', [ref]$createdNew)
if (-not $createdNew) { $mutex.Dispose(); exit 0 }
try {
  while ($true) {
    $now = Get-Date
    $next = Get-Date -Hour 3 -Minute 0 -Second 0
    if ($next -le $now) { $next = $next.AddDays(1) }
    $delay = [int][Math]::Max(1, ($next - $now).TotalSeconds)
    Start-Sleep -Seconds $delay
    & node.exe .\scripts\backup.mjs *> $null
    Start-Sleep -Seconds 2
  }
} finally {
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
