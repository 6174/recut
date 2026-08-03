<#
 [INPUT]: 依赖 PowerShell、HTTPS 下载、SHA-256、Expand-Archive 和 Windows Task Scheduler
 [OUTPUT]: 安装或原子升级 %USERPROFILE%\.recut\bin\recut-service.exe，并注册/启动当前用户的登录任务
 [POS]: web/public 的无源码 Windows 安装入口；与 install.sh 共享发布 manifest，绝不读取或删除用户项目数据
 [PROTOCOL]: 变更时更新此头部，然后检查 README.md
#>
[CmdletBinding()]
param(
  [string]$DownloadBase = $(if ($env:RECUT_DOWNLOAD_BASE_URL) { $env:RECUT_DOWNLOAD_BASE_URL } else { "https://recut.video" }),
  [string]$RecutHome = $(if ($env:RECUT_HOME) { $env:RECUT_HOME } else { Join-Path $HOME ".recut" })
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  throw "Recut installer: $Message`n请将完整输出交给 Codex、Claude Code 或 OpenCode 诊断；不要删除 $RecutHome 中的用户数据。"
}

$architecture = switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { "amd64"; break }
  "ARM64" { "arm64"; break }
  default { Fail "暂不支持 $env:PROCESSOR_ARCHITECTURE CPU" }
}
$os = "windows"
$packageKey = "$os-$architecture"
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("recut-install-" + [System.Guid]::NewGuid())

try {
  New-Item -ItemType Directory -Path $temporary | Out-Null
  $base = $DownloadBase.TrimEnd('/')
  $manifestPath = Join-Path $temporary "manifest.json"
  Invoke-WebRequest -UseBasicParsing -Uri "$base/releases/latest/manifest.json" -OutFile $manifestPath
  $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
  $package = $manifest.packages.$packageKey
  if (-not $manifest.version) { Fail "release manifest 缺少版本" }
  if (-not $package -or -not $package.archive -or -not $package.sha256) { Fail "release manifest 缺少 $packageKey 包" }
  if (-not $package.archive.EndsWith(".zip")) { Fail "Windows release 包格式无效" }

  $archivePath = Join-Path $temporary $package.archive
  Invoke-WebRequest -UseBasicParsing -Uri "$base/releases/latest/$($package.archive)" -OutFile $archivePath
  $actualChecksum = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
  if ($actualChecksum -ne $package.sha256.ToLowerInvariant()) { Fail "发布包校验失败" }

  $extractPath = Join-Path $temporary "extract"
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $binaryName = "recut-service-$packageKey.exe"
  $sourceBinary = Join-Path $extractPath $binaryName
  if (-not (Test-Path -LiteralPath $sourceBinary -PathType Leaf)) { Fail "发布包缺少 service binary" }

  $binDirectory = Join-Path $RecutHome "bin"
  $logDirectory = Join-Path $RecutHome "logs"
  New-Item -ItemType Directory -Force -Path $binDirectory, $logDirectory | Out-Null
  $serviceBinary = Join-Path $binDirectory "recut-service.exe"
  & schtasks.exe /End /TN "Recut Service" 2>$null | Out-Null
  Copy-Item -LiteralPath $sourceBinary -Destination "$serviceBinary.new" -Force
  $activated = $false
  foreach ($attempt in 1..10) {
    try {
      Move-Item -LiteralPath "$serviceBinary.new" -Destination $serviceBinary -Force
      $activated = $true
      break
    }
    catch {
      Start-Sleep -Milliseconds 300
    }
  }
  if (-not $activated) { Fail "无法替换正在运行的 service binary" }

  $taskCommand = ('"{0}" --data-dir "{1}"' -f $serviceBinary, $RecutHome)
  & schtasks.exe /Create /TN "Recut Service" /TR $taskCommand /SC ONLOGON /RL LIMITED /F | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "无法注册 Windows 登录任务" }
  & schtasks.exe /Run /TN "Recut Service" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "无法启动 Windows service" }

  Write-Host "Recut service $($manifest.version) 已安装/升级。请刷新 https://recut.video。"
}
catch {
  Write-Error $_
  exit 1
}
finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
