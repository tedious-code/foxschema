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
  $Version = npm view foxschema version
  if (-not $Version) { throw "Could not resolve foxschema version from npm" }
}

$stage = Join-Path $OutDir "stage"
$zipName = "foxschema-$Version-win-x64.zip"
$zipPath = Join-Path $OutDir $zipName

Remove-Item -Recurse -Force $OutDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Push-Location $OutDir
try {
  Write-Host "npm pack foxschema@$Version"
  npm pack "foxschema@$Version" --pack-destination .
  $tgz = Get-ChildItem -Filter "foxschema-$Version.tgz" | Select-Object -First 1
  if (-not $tgz) { throw "npm pack did not produce foxschema-$Version.tgz" }
  tar -xzf $tgz.Name
  # npm pack extracts to package/
  if (-not (Test-Path "package/dist/index.js")) {
    throw "Unexpected npm pack layout — missing package/dist/index.js"
  }
  Copy-Item -Recurse -Force "package/*" $stage
} finally {
  Pop-Location
}

Push-Location $stage
try {
  npm install --omit=dev --no-fund --no-audit
} finally {
  Pop-Location
}

@"
@echo off
setlocal
set "ROOT=%~dp0"
node "%ROOT%dist\index.js" %*
"@ | Set-Content -Encoding ASCII (Join-Path $stage "foxschema.cmd")

@"
@echo off
setlocal
set "ROOT=%~dp0"
node "%ROOT%dist\index.js" %*
"@ | Set-Content -Encoding ASCII (Join-Path $stage "fox.cmd")

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

$sha = (Get-FileHash -Algorithm SHA256 $zipPath).Hash
Write-Host "ZIP=$zipPath"
Write-Host "SHA256=$sha"
Write-Host "VERSION=$Version"
