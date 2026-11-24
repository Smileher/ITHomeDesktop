[CmdletBinding()]
param([ValidateSet('x64','arm64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = if ($Architecture -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$previousStoreBuild = $env:ITHOME_STORE_BUILD
Push-Location $root
try {
  $env:ITHOME_STORE_BUILD = $null
  & node node_modules/@tauri-apps/cli/tauri.js build --target $target --bundles nsis --ci -- --locked
  if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
  $version = (Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $output = Join-Path $root "src-tauri/target/release-assets/$Architecture"
  $stage = Join-Path $output "portable-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Copy-Item -LiteralPath "src-tauri/target/$target/release/ithome-desktop.exe" -Destination (Join-Path $stage 'ITHomeDesktop.exe')
  $notice = "IT之家第三方客户端（非官方）`n版本：$version`n此程序需要 Microsoft Edge WebView2 运行时。`n数据保存于当前用户的应用本地数据目录；便携包仅表示免安装。`nhttps://smileher.github.io/ITHomeDesktop/`n"
  [IO.File]::WriteAllText((Join-Path $stage '使用说明.txt'), $notice, [Text.UTF8Encoding]::new($false))
  $zip = Join-Path $output "ITHomeDesktop_${version}_${Architecture}_portable.zip"
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
  Get-ChildItem -LiteralPath "src-tauri/target/$target/release/bundle/nsis" -Filter "*_${version}_*-setup.exe" | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $output "ITHomeDesktop_${version}_${Architecture}_setup.exe") -Force }
  $checksums = Get-ChildItem -LiteralPath $output -File | Where-Object Extension -In '.zip','.exe' | ForEach-Object { "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)" }
  [IO.File]::WriteAllLines((Join-Path $output 'SHA256SUMS.txt'), [string[]]$checksums, [Text.UTF8Encoding]::new($false))
  Write-Output $output
} finally { $env:ITHOME_STORE_BUILD = $previousStoreBuild; Pop-Location }
