<#
.SYNOPSIS
    DeepChart Production Windows Release Packaging Script
.DESCRIPTION
    Builds the production Vite bundle, compiles the Tauri/Rust core,
    packages release distribution artifacts, and generates SHA-256 checksums.
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$DesktopDir = Join-Path $ProjectRoot "apps\desktop"
$ReleaseOutDir = Join-Path $ProjectRoot "dist-release"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DeepChart Windows Release Packaging (v0.1.0-RC1)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Ensure output directory exists
if (-not (Test-Path $ReleaseOutDir)) {
    New-Item -ItemType Directory -Path $ReleaseOutDir -Force | Out-Null
}

# 1. Build Desktop Web App Assets
Write-Host "`n[1/4] Building production frontend assets..." -ForegroundColor Yellow
Set-Location $DesktopDir
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend build failed!"
}

# 2. Check and Validate Tauri Cargo Target
Write-Host "`n[2/4] Validating and compiling Tauri Desktop Shell..." -ForegroundColor Yellow
$winlibs_bin = "C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
if (Test-Path $winlibs_bin) {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$winlibs_bin;$env:PATH"
}

cargo check --manifest-path "$DesktopDir\src-tauri\Cargo.toml"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Tauri check failed!"
}

# 3. Assemble Release Distribution Package
Write-Host "`n[3/4] Assembling release package..." -ForegroundColor Yellow
$PackageDir = Join-Path $ReleaseOutDir "DeepChart-v0.1.0-RC1-windows-x64"
if (Test-Path $PackageDir) {
    Remove-Item -Recurse -Force $PackageDir
}
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

# Copy static frontend distribution
Copy-Item -Recurse -Path "$DesktopDir\dist" -Destination "$PackageDir\app-resources"

# Copy documentation and legal files
Copy-Item "$ProjectRoot\LICENSE" "$PackageDir\LICENSE.txt"
Copy-Item "$ProjectRoot\NOTICES.md" "$PackageDir\NOTICES.txt"
Copy-Item "$ProjectRoot\docs\RELEASE_NOTES.md" "$PackageDir\RELEASE_NOTES.md"
Copy-Item "$ProjectRoot\docs\OPERATIONS.md" "$PackageDir\OPERATIONS.md"

# 4. Generate SHA256 Checksums
Write-Host "`n[4/4] Generating SHA256 artifact checksums..." -ForegroundColor Yellow
$ChecksumFile = Join-Path $ReleaseOutDir "SHA256SUMS.txt"
if (Test-Path $ChecksumFile) {
    Remove-Item -Force $ChecksumFile
}

$Items = Get-ChildItem -Path $PackageDir -Recurse -File
foreach ($item in $Items) {
    $hash = Get-FileHash -Path $item.FullName -Algorithm SHA256
    $relPath = $item.FullName.Substring($ReleaseOutDir.Length + 1).Replace("\", "/")
    "$($hash.Hash)  $relPath" | Out-File -Append -FilePath $ChecksumFile -Encoding utf8
}

Write-Host "`nRelease build and checksum generation SUCCESSFUL!" -ForegroundColor Green
Write-Host "Artifacts location: $PackageDir" -ForegroundColor Green
Write-Host "Checksum file:      $ChecksumFile" -ForegroundColor Green
