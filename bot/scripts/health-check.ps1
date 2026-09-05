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
    if ($health.status -eq "conflict") {
      "[$(Get-Date -Format o)] Polling conflict is recorded; automatic restart skipped." | Out-File -FilePath $logPath -Append -Encoding utf8
      exit 0
    }
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
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    $state = (Get-ScheduledTask -TaskName "AnonGenderChatBot" -ErrorAction SilentlyContinue).State
    if ($state -ne "Running") { break }
    Start-Sleep -Seconds 1
  }
  Start-ScheduledTask -TaskName "AnonGenderChatBot"
}
