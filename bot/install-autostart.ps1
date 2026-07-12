$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$taskName = "AnonGenderChatBot"
$runner = Join-Path $PSScriptRoot "run-background.ps1"
$powershell = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Анонимный Telegram-чат: ожидание токена и автоматический перезапуск" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Автозапуск установлен. Задача $taskName ждёт BOT_TOKEN в bot\.env."

