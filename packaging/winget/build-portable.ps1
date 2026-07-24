# Build a Windows portable zip for winget from the published npm package.
# Includes foxschema.exe / fox.exe launchers (winget portable forbids .cmd).
#
# Usage (windows-latest):
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
$launcherCs = Join-Path $root "packaging/winget/FoxschemaLauncher.cs"

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

# Compile portable .exe launchers. Prefer VS Roslyn csc; avoid ancient Shared\Packages copies.
$csc = $null
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  $vsPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath 2>$null
  if (-not $vsPath) {
    $vsPath = & $vswhere -latest -products * -property installationPath 2>$null
  }
  if ($vsPath) {
    $csc = Get-ChildItem -Path (Join-Path $vsPath "MSBuild") -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\Roslyn\\b' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $csc) {
  $csc = Get-ChildItem -Path "${env:ProgramFiles}\Microsoft Visual Studio","${env:ProgramFiles(x86)}\Microsoft Visual Studio" `
    -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\Roslyn\\b' -and $_.FullName -notmatch '\\Shared\\Packages\\' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $csc) {
  # Last resort: any Framework csc
  $csc = Get-ChildItem -Path "${env:WINDIR}\Microsoft.NET\Framework64" -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $csc) { throw "csc.exe not found — need .NET / VS Build Tools on the runner" }

Write-Host "Using csc: $csc"
$exeMain = Join-Path $stage "foxschema.exe"
$exeFox = Join-Path $stage "fox.exe"
& $csc /nologo /optimize+ /target:exe /out:$exeMain /reference:System.dll $launcherCs
if ($LASTEXITCODE -ne 0) { throw "csc failed for foxschema.exe" }
Copy-Item -Force $exeMain $exeFox

# Remove any leftover cmd stubs if present
Remove-Item -Force (Join-Path $stage "foxschema.cmd") -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $stage "fox.cmd") -ErrorAction SilentlyContinue

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

$sha = (Get-FileHash -Algorithm SHA256 $zipPath).Hash
Write-Host "ZIP=$zipPath"
Write-Host "SHA256=$sha"
Write-Host "VERSION=$Version"
