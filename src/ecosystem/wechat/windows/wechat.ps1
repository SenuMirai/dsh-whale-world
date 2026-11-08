param(
  [ValidateSet('Install', 'Build', 'Probe', 'Status', 'Chats', 'Start', 'Stop', 'Send', 'Acknowledge')]
  [string]$Action = 'Status',
  [string]$ConfigFile,
  [string]$Chat,
  [string]$Text,
  [string]$MessageId,
  [int]$Limit = 20,
  [int]$Offset = 0,
  [switch]$AllowSend,
  [switch]$Background
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$runtimeDir = Join-Path $workspaceRoot '.host\wechat'
$pythonPath = Join-Path $runtimeDir '.venv\Scripts\python.exe'
if (-not $ConfigFile) { $ConfigFile = Join-Path $runtimeDir 'config.json' }
$ConfigFile = [IO.Path]::GetFullPath($ConfigFile)
$pidFile = $ConfigFile + '.pid'
if ($Action -eq 'Build') { & (Join-Path $PSScriptRoot 'engine\build.ps1'); exit }
if ($Action -eq 'Stop') {
  if (-not (Test-Path -LiteralPath $pidFile)) { throw '没有此配置的后台进程记录' }
  $workerId = [int]([IO.File]::ReadAllText($pidFile))
  $worker = Get-CimInstance Win32_Process -Filter "ProcessId = $workerId"
  if ($worker) {
    $adapterPath = Join-Path $PSScriptRoot 'adapter.py'
    if ($worker.ExecutablePath -ne $pythonPath -or -not $worker.CommandLine.Contains($adapterPath) -or -not $worker.CommandLine.Contains($ConfigFile)) { throw '进程标识不匹配，拒绝停止其他程序' }
    # Windows venv launches a child interpreter; stopping only the launcher leaves it running.
    $interpreters = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $workerId" | Where-Object {
      $_.ExecutablePath -and [IO.Path]::GetFileName($_.ExecutablePath) -eq 'python.exe' -and
      $_.CommandLine.Contains($adapterPath) -and $_.CommandLine.Contains($ConfigFile)
    })
    foreach ($interpreter in $interpreters) { Stop-Process -Id $interpreter.ProcessId -ErrorAction Stop }
    if (Get-Process -Id $workerId -ErrorAction SilentlyContinue) {
      try { Stop-Process -Id $workerId -ErrorAction Stop }
      catch { if (Get-Process -Id $workerId -ErrorAction SilentlyContinue) { throw } }
    }
  }
  Remove-Item -LiteralPath $pidFile
  Write-Output '微信监听已停止；正在处理的消息若未确认，下一次启动会要求人工核对。'
  exit
}
if ($Action -eq 'Install') {
  if (-not (Test-Path -LiteralPath $pythonPath)) {
    & python -m venv (Join-Path $runtimeDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python 环境创建失败' }
  }
  & $pythonPath -m pip install --disable-pip-version-check --no-input -r (Join-Path $PSScriptRoot 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw '微信依赖安装失败' }
  exit
}
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '先运行 wechat.ps1 Install' }
if (-not (Test-Path -LiteralPath $ConfigFile)) { throw '先按 README 创建本机 config.json' }
$adapterCommand = @{ Status = 'status'; Probe = 'probe'; Chats = 'chats'; Start = 'watch'; Send = 'send'; Acknowledge = 'acknowledge' }[$Action]
$adapterArgs = @((Join-Path $PSScriptRoot 'adapter.py'), $adapterCommand, '--config', $ConfigFile)
if ($Action -eq 'Chats') { $adapterArgs += @('--limit', $Limit, '--offset', $Offset) }
if ($Chat) { $adapterArgs += @('--chat', $Chat) }
if ($Text) { $adapterArgs += @('--text', $Text) }
if ($MessageId) { $adapterArgs += @('--message-id', $MessageId) }
if ($AllowSend) { $adapterArgs += '--allow-send' }
if ($Background) {
  if ($Action -ne 'Start' -or -not $AllowSend) { throw '后台运行仅适用于 Start -AllowSend' }
  if (Test-Path -LiteralPath $pidFile) {
    $previousWorkerId = [int]([IO.File]::ReadAllText($pidFile))
    if (Get-Process -Id $previousWorkerId -ErrorAction SilentlyContinue) { throw '此配置已有后台进程记录，先使用 Stop，不能重复启动' }
  }
  $backgroundArgs = @('-X', 'utf8', '-u') + $adapterArgs
  $quotedArgs = $backgroundArgs | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
  $worker = Start-Process -FilePath $pythonPath -ArgumentList $quotedArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput ($ConfigFile + '.out.log') -RedirectStandardError ($ConfigFile + '.err.log')
  [IO.File]::WriteAllText($pidFile, [string]$worker.Id)
  Write-Output ('微信监听已在后台启动，PID ' + $worker.Id)
  exit
}
& $pythonPath @adapterArgs
if ($LASTEXITCODE -ne 0) { throw '微信适配器已停止，见上方具体原因' }
