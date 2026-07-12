$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$healthPath = Join-Path $root "data\health.json"
$logDirectory = Join-Path $root "logs"
$logPath = Join-Path $logDirectory "health-check.log"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$stale = $true
if (Test-Path -LiteralPath $healthPath) {
  try {
    $health = Get-Content -Raw -Encoding utf8 -LiteralPath $healthPath | ConvertFrom-Json
    $updated = [DateTimeOffset]::Parse($health.updated_at)
    $stale = ([DateTimeOffset]::UtcNow - $updated).TotalMinutes -gt 2
  }
  catch {
    $stale = $true
  }
}

if ($stale) {
  "[$(Get-Date -Format o)] Health file is stale; restarting bot task." | Out-File -FilePath $logPath -Append -Encoding utf8
  Stop-ScheduledTask -TaskName "AnonGenderChatBot" -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName "AnonGenderChatBot"
}
