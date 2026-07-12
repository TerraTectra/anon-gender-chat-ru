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

$node = (Get-Command node.exe).Source
$backupScript = Join-Path $PSScriptRoot "scripts\backup.mjs"
$backupAction = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "`"$backupScript`"" `
  -WorkingDirectory $PSScriptRoot
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "03:00"
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask `
  -TaskName "AnonGenderChatBackup" `
  -Action $backupAction `
  -Trigger $backupTrigger `
  -Settings $backupSettings `
  -Description "Ежедневные резервные копии баз Telegram-ботов" `
  -Force | Out-Null

$healthScript = Join-Path $PSScriptRoot "scripts\health-check.ps1"
$healthAction = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$healthScript`"" `
  -WorkingDirectory $PSScriptRoot
$healthTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$healthSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask `
  -TaskName "AnonGenderChatHealthCheck" `
  -Action $healthAction `
  -Trigger $healthTrigger `
  -Settings $healthSettings `
  -Description "Перезапуск сети Telegram-ботов при устаревшем health.json" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Автозапуск, проверка здоровья и ежедневные резервные копии установлены."
