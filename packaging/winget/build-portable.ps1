# Build a Windows portable zip for winget (CLI + UI, Node required on PATH).
# Run on windows-latest after: npm install && build web + cli && prepare-publish.
#
# Output: dist/foxschema-<version>-win-x64.zip

param(
  [string]$PackDir = "apps/cli/npm-pack",
  [string]$OutDir = "dist/winget"
)

$ErrorActionPreference = "Stop"
$pkg = Get-Content (Join-Path $PackDir "package.json") | ConvertFrom-Json
$version = $pkg.version
$stage = Join-Path $OutDir "stage"
$zipName = "foxschema-$version-win-x64.zip"
$zipPath = Join-Path $OutDir $zipName

if (-not (Test-Path (Join-Path $PackDir "dist/index.js"))) {
  throw "Missing $PackDir/dist — run prepare-publish.mjs first"
}

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Recurse -Force (Join-Path $PackDir "*") $stage

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

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

$sha = (Get-FileHash -Algorithm SHA256 $zipPath).Hash
Write-Host "ZIP=$zipPath"
Write-Host "SHA256=$sha"
Write-Host "VERSION=$version"
"ZIP=$zipPath" | Out-File -Encoding utf8 (Join-Path $OutDir "build.env")
"SHA256=$sha" | Out-File -Append -Encoding utf8 (Join-Path $OutDir "build.env")
"VERSION=$version" | Out-File -Append -Encoding utf8 (Join-Path $OutDir "build.env")
