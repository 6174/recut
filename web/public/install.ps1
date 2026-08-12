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

function Log([string]$Message) {
  Write-Host "[Recut install] $Message"
}

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
  Log "检查系统与创建临时目录"
  New-Item -ItemType Directory -Path $temporary | Out-Null
  $base = $DownloadBase.TrimEnd('/')
  $manifestPath = Join-Path $temporary "manifest.json"
  Log "下载发布清单"
  Invoke-WebRequest -UseBasicParsing -Uri "$base/releases/latest/manifest.json" -OutFile $manifestPath
  $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
  $package = $manifest.packages.$packageKey
  if (-not $manifest.version) { Fail "release manifest 缺少版本" }
  if (-not $package -or -not $package.archive -or -not $package.sha256) { Fail "release manifest 缺少 $packageKey 包" }
  if (-not $package.archive.EndsWith(".zip")) { Fail "Windows release 包格式无效" }

  $archivePath = Join-Path $temporary $package.archive
  Log "下载 Recut service $($manifest.version)"
  Invoke-WebRequest -UseBasicParsing -Uri "$base/releases/latest/$($package.archive)" -OutFile $archivePath
  Log "校验发布包完整性"
  $actualChecksum = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
  if ($actualChecksum -ne $package.sha256.ToLowerInvariant()) { Fail "发布包校验失败" }

  $extractPath = Join-Path $temporary "extract"
  Log "解压并激活 service"
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

  $uvDirectory = Join-Path $RecutHome "tools\uv"
  $uv = Join-Path $uvDirectory "uv.exe"
  Log "准备平台 Python 3.11、venv 与 FFmpeg"
  if (-not (Test-Path -LiteralPath $uv -PathType Leaf)) {
    Log "下载受管 Python 安装器"
    $uvInstaller = Join-Path $temporary "uv-installer.ps1"
    Invoke-WebRequest -UseBasicParsing -Uri "https://astral.sh/uv/install.ps1" -OutFile $uvInstaller
    $env:UV_INSTALL_DIR = $uvDirectory
    & powershell.exe -ExecutionPolicy Bypass -File $uvInstaller
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $uv -PathType Leaf)) { Fail "无法安装受管 Python 安装器" }
  }
  else { Log "复用已安装的受管 Python 安装器" }
  Log "安装或复用 Python 3.11"
  & $uv python install 3.11
  if ($LASTEXITCODE -ne 0) { Fail "无法准备 Python 3.11" }
  $platformPython = (& $uv python find 3.11).Trim()
  if (-not $platformPython) { Fail "无法定位受管 Python 3.11" }
  $platformVenv = Join-Path $RecutHome "python\platform\3.11"
  $platformVenvPython = Join-Path $platformVenv "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $platformVenvPython -PathType Leaf)) {
    Log "创建平台默认 venv"
    New-Item -ItemType Directory -Force -Path (Split-Path $platformVenv) | Out-Null
    & $platformPython -m venv $platformVenv
    if ($LASTEXITCODE -ne 0) { Fail "无法创建平台默认 venv" }
  }
  else { Log "复用平台默认 venv" }
  Log "安装平台 FFmpeg"
  & $platformVenvPython -m pip install --disable-pip-version-check --upgrade imageio-ffmpeg
  if ($LASTEXITCODE -ne 0) { Fail "无法安装平台 FFmpeg" }
  $env:RECUT_PLATFORM_VENV = $platformVenv
  & $platformVenvPython -c 'from pathlib import Path; import imageio_ffmpeg, os, shutil; source = Path(imageio_ffmpeg.get_ffmpeg_exe()); target = Path(os.environ["RECUT_PLATFORM_VENV"]) / "Scripts" / "ffmpeg.exe"; shutil.copy2(source, target); print("[Recut install] FFmpeg 已就绪")'
  if ($LASTEXITCODE -ne 0) { Fail "无法激活平台 FFmpeg" }

  $taskCommand = ('"{0}" --data-dir "{1}"' -f $serviceBinary, $RecutHome)
  Log "注册并启动 Windows 本地服务"
  & schtasks.exe /Create /TN "Recut Service" /TR $taskCommand /SC ONLOGON /RL LIMITED /F | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "无法注册 Windows 登录任务" }
  & schtasks.exe /Run /TN "Recut Service" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "无法启动 Windows service" }

  Log "完成：Recut service $($manifest.version) 已安装/升级。请刷新 https://recut.video。"
}
catch {
  Write-Error $_
  exit 1
}
finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
