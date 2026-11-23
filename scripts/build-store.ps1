[CmdletBinding()]
param(
  [string]$IdentityName = $env:ITHOME_MSIX_IDENTITY,
  [string]$Publisher = $env:ITHOME_MSIX_PUBLISHER,
  [switch]$AllArchitectures,
  [switch]$DevelopmentPackage
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($DevelopmentPackage) { $IdentityName = 'Smileher.ITHomeDesktop.Development'; $Publisher = 'CN=Smileher'; }
if ([string]::IsNullOrWhiteSpace($IdentityName) -or [string]::IsNullOrWhiteSpace($Publisher)) { throw 'Provide this app''s Partner Center identity and publisher. RemindOn identity must not be reused. Use -DevelopmentPackage only for unsigned packaging verification.' }
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeAppx = Get-ChildItem -LiteralPath $sdk -Directory | Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' | Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'x64/makeappx.exe' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (!$makeAppx) { throw 'Windows SDK MakeAppx.exe is required.' }
$previousStoreBuild = $env:ITHOME_STORE_BUILD
Push-Location $root
try {
  $packageVersion = (Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $configVersion = (Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ($packageVersion -ne $configVersion -or $packageVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Application versions must match and use three numeric components.' }
  $version = "$packageVersion.0"
  foreach ($part in $version.Split('.')) { $number = [uint16]0; if (![uint16]::TryParse($part, [ref]$number)) { throw 'MSIX version component exceeds 65535.' } }
  $channel = if ($DevelopmentPackage) { 'development' } else { 'upload' }
  $output = Join-Path $root "src-tauri/target/store/$version/$channel"
  $packages = Join-Path $output "packages-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $packages -Force | Out-Null
  $targets = @(@{ Architecture='x64'; Target='x86_64-pc-windows-msvc' })
  if ($AllArchitectures) { $targets += @{ Architecture='arm64'; Target='aarch64-pc-windows-msvc' } }
  $env:ITHOME_STORE_BUILD = '1'
  foreach ($target in $targets) {
    & node node_modules/@tauri-apps/cli/tauri.js build --target $target.Target --no-bundle --ci -- --locked
    if ($LASTEXITCODE -ne 0) { throw "Store executable build failed: $($target.Architecture)" }
    $stage = Join-Path $output "stage-$($target.Architecture)-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null
    Copy-Item -LiteralPath "src-tauri/target/$($target.Target)/release/ithome-desktop.exe" -Destination (Join-Path $stage 'ITHomeDesktop.exe')
    foreach ($logo in @('StoreLogo.png','Square44x44Logo.png','Square150x150Logo.png')) { Copy-Item -LiteralPath "src-tauri/icons/$logo" -Destination (Join-Path $stage "Assets/$logo") }
    $safeIdentity = [Security.SecurityElement]::Escape($IdentityName)
    $safePublisher = [Security.SecurityElement]::Escape($Publisher)
    $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="$safeIdentity" Publisher="$safePublisher" Version="$version" ProcessorArchitecture="$($target.Architecture)"/>
  <Properties><DisplayName>IT之家第三方客户端（非官方）</DisplayName><PublisherDisplayName>Smileher</PublisherDisplayName><Description>第三方科技资讯阅读客户端，与 IT之家官方无隶属关系。</Description><Logo>Assets\StoreLogo.png</Logo></Properties>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
  <Resources><Resource Language="zh-CN"/><Resource Language="en-US"/></Resources>
  <Applications><Application Id="ITHomeDesktop" Executable="ITHomeDesktop.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="IT之家第三方客户端（非官方）" Description="第三方科技资讯阅读客户端" BackgroundColor="transparent" Square44x44Logo="Assets\Square44x44Logo.png" Square150x150Logo="Assets\Square150x150Logo.png"/></Application></Applications>
  <Capabilities><Capability Name="internetClient"/><rescap:Capability Name="runFullTrust"/></Capabilities>
</Package>
"@
    [IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))
    $package = Join-Path $packages "ITHomeDesktop_${version}_$($target.Architecture).msix"
    & $makeAppx pack /d $stage /p $package /o
    if ($LASTEXITCODE -ne 0) { throw 'MSIX validation or packing failed.' }
    Copy-Item -LiteralPath $package -Destination $output -Force
  }
  if ($AllArchitectures) {
    & $makeAppx bundle /d $packages /p (Join-Path $output "ITHomeDesktop_${version}.msixbundle") /o
    if ($LASTEXITCODE -ne 0) { throw 'MSIX bundle validation failed.' }
  }
  if ($DevelopmentPackage) { Write-Output 'DEVELOPMENT PACKAGES ONLY: unsigned, not for Microsoft Store submission or end-user installation.' }
  Write-Output $output
} finally { $env:ITHOME_STORE_BUILD = $previousStoreBuild; Pop-Location }
