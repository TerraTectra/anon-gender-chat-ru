$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Создан bot\.env. Вставьте BOT_TOKEN и запустите start.ps1 ещё раз."
  notepad.exe ".env"
  exit 1
}

$token = Get-Content -LiteralPath ".env" | Where-Object { $_ -match '^BOT_TOKEN=.+$' }
if (-not $token) {
  Write-Host "В bot\.env не заполнен BOT_TOKEN."
  notepad.exe ".env"
  exit 1
}

if (-not (Test-Path -LiteralPath "node_modules")) {
  npm install
}

npm start

