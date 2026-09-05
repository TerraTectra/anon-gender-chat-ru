$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'run-background.ps1'
$health = Join-Path $root 'data\health.json'
$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\TerraTectraHealthLoop', [ref]$createdNew)
if (-not $createdNew) { $mutex.Dispose(); exit 0 }
try {
  while ($true) {
    $runnerPattern = [regex]::Escape($runner)
    $runnerAlive = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match $runnerPattern } | Select-Object -First 1
    $healthStatus = $null
    $healthStale = $true
    if (Test-Path -LiteralPath $health) {
      try {
        $state = Get-Content -LiteralPath $health -Raw | ConvertFrom-Json
        $healthStatus = [string]$state.status
        $updated = [datetime]::Parse([string]$state.updated_at).ToUniversalTime()
        $healthStale = (([datetime]::UtcNow - $updated).TotalMinutes -gt 3)
      } catch { }
    }
    if (-not $runnerAlive -and $healthStatus -ne 'conflict') {
      Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$runner)
    }
    Start-Sleep -Seconds 60
  }
} finally {
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
