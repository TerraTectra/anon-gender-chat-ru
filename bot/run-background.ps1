$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

while ($true) {
  if (-not (Test-Path -LiteralPath ".env")) {
    Start-Sleep -Seconds 5
    continue
  }

  $token = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^BOT_TOKEN=.+$' }
  if (-not $token) {
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

  npm start
  Start-Sleep -Seconds 5
}

