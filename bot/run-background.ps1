$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$logDirectory = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$env:NODE_NO_WARNINGS = "1"
$createdNew = $false
$runnerMutex = [System.Threading.Mutex]::new($true, "Local\TerraTectraAnonChatNetworkRunner", [ref]$createdNew)
if (-not $createdNew) {
  $runnerMutex.Dispose()
  exit 0
}

function Protect-LogLine {
  param([Parameter(ValueFromPipeline = $true)] $Line)
  process {
    $text = [string]$Line
    $text = $text -replace 'https://api\.telegram\.org/(?:file/)?bot[^/\s]+', 'https://api.telegram.org/bot[REDACTED]'
    $text -replace '\b\d{6,}:[A-Za-z0-9_-]{20,}\b', '[TELEGRAM_TOKEN_REDACTED]'
  }
}

try {
  while ($true) {
    if (-not (Test-Path -LiteralPath ".env")) {
      Start-Sleep -Seconds 5
      continue
    }

    $userTokenLine = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue |
      Where-Object { $_ -match '^BOT_TOKEN=.+$' }
    $adminTokenLine = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue |
      Where-Object { $_ -match '^ADMIN_BOT_TOKEN=.+$' }
    if (-not $userTokenLine -or -not $adminTokenLine) {
      Start-Sleep -Seconds 5
      continue
    }

    if (-not (Test-Path -LiteralPath "node_modules")) {
      & npm.cmd install
      if ($LASTEXITCODE -ne 0) {
        Start-Sleep -Seconds 30
        continue
      }
    }

    $logFile = Join-Path $logDirectory ("bot-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
    "[$(Get-Date -Format o)] Starting bot network" | Out-File -FilePath $logFile -Append -Encoding utf8
    & npm.cmd start 2>&1 | Protect-LogLine | Out-File -FilePath $logFile -Append -Encoding utf8
    $networkExitCode = $LASTEXITCODE
    "[$(Get-Date -Format o)] Bot network stopped with exit code $networkExitCode" | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($networkExitCode -eq 73) {
      "[$(Get-Date -Format o)] Duplicate or remote Telegram polling conflict detected; automatic restart stopped." | Out-File -FilePath $logFile -Append -Encoding utf8
      break
    }
    Start-Sleep -Seconds 5
  }
}
finally {
  $runnerMutex.ReleaseMutex()
  $runnerMutex.Dispose()
}
