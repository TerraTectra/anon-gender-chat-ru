$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$logDirectory = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$env:NODE_NO_WARNINGS = "1"

while ($true) {
  if (-not (Test-Path -LiteralPath ".env")) {
    Start-Sleep -Seconds 5
    continue
  }

  $token = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^BOT_TOKEN=.+$' }
  $adminToken = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^ADMIN_BOT_TOKEN=.+$' }
  if (-not $token -or -not $adminToken) {
    Start-Sleep -Seconds 5
    continue
  }

  if (-not (Test-Path -LiteralPath "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) {
      Start-Sleep -Seconds 30
      continue
    }
  }

  $logFile = Join-Path $logDirectory ("bot-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
  "[$(Get-Date -Format o)] Starting bot network" | Out-File -FilePath $logFile -Append -Encoding utf8
  npm start 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
  "[$(Get-Date -Format o)] Bot network stopped with exit code $LASTEXITCODE" | Out-File -FilePath $logFile -Append -Encoding utf8
  Start-Sleep -Seconds 5
}
