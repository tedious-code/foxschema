# Build a Windows portable zip for winget from the published npm package.
# Requires Node/npm on PATH. Output: dist/winget/foxschema-<ver>-win-x64.zip
#
# Usage:
#   ./packaging/winget/build-portable.ps1 [-Version 0.1.67]

param(
  [string]$Version = "",
  [string]$OutDir = "dist/winget"
)

$ErrorActionPreference = "Stop"

if (-not $Version) {
  $Version = (npm view foxschema version).Trim()
  if (-not $Version) { throw "Could not resolve foxschema version from npm" }
}

$root = (Get-Location).Path
$outAbs = Join-Path $root $OutDir
$stage = Join-Path $outAbs "stage"
$extract = Join-Path $outAbs "extract"
$zipPath = Join-Path $outAbs "foxschema-$Version-win-x64.zip"

Remove-Item -Recurse -Force $outAbs -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path $extract | Out-Null

Write-Host "npm pack foxschema@$Version"
Push-Location $extract
try {
  npm pack "foxschema@$Version" | Out-Host
  $tgz = Get-ChildItem -Filter "foxschema-$Version.tgz" | Select-Object -First 1
  if (-not $tgz) { throw "npm pack did not produce foxschema-$Version.tgz" }
  tar -xzf $tgz.FullName
  $pkgDir = Join-Path $extract "package"
  if (-not (Test-Path (Join-Path $pkgDir "dist/index.js"))) {
    throw "Unexpected npm pack layout — missing package/dist/index.js"
  }
  Copy-Item -Path (Join-Path $pkgDir "*") -Destination $stage -Recurse -Force
} finally {
  Pop-Location
}

Push-Location $stage
try {
  npm install --omit=dev --no-fund --no-audit
} finally {
  Pop-Location
}

$launcher = @"
@echo off
setlocal
set "ROOT=%~dp0"
node "%ROOT%dist\index.js" %*
"@
Set-Content -Encoding ASCII -Path (Join-Path $stage "foxschema.cmd") -Value $launcher
Set-Content -Encoding ASCII -Path (Join-Path $stage "fox.cmd") -Value $launcher

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

$sha = (Get-FileHash -Algorithm SHA256 $zipPath).Hash
Write-Host "ZIP=$zipPath"
Write-Host "SHA256=$sha"
Write-Host "VERSION=$Version"
