<#
.SYNOPSIS
    DeepChart / VluxChart Production Windows Desktop Build & Release Packaging Script
.DESCRIPTION
    Builds the production Vite bundle, compiles the optimized lightweight Tauri 2
    Windows native executable (`deepchart-desktop.exe`) and NSIS Setup installer,
    assembles the portable Windows x64 distribution (zero bulky historical datasets
    bundled inside the .exe — uses On-Demand Market Data Packs after Login),
    and generates SHA-256 checksums.
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$DesktopDir = Join-Path $ProjectRoot "apps\desktop"
$TauriDir = Join-Path $DesktopDir "src-tauri"
$ReleaseOutDir = Join-Path $ProjectRoot "dist-release"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DeepChart / VluxChart Windows Desktop Build (v0.1.0)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Ensure clean 64-bit WinLibs MinGW toolchain priority on Windows GNU
$winlibs = "C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
$cargo = "$env:USERPROFILE\.cargo\bin"
if (Test-Path $winlibs) {
    $cleanPaths = ($env:PATH -split ';') | Where-Object {
        $_ -and
        $_ -notmatch "MinGW" -and
        $_ -notmatch "llvm-mingw" -and
        $_ -notmatch "BrechtSanders"
    }
    $env:PATH = "$winlibs;$cargo;" + ($cleanPaths -join ';')
}

# Terminate any running desktop instance or stale MT5 bridge daemon to release binary & port 15556 locks
Get-Process -Name "deepchart-desktop", "VluxChart-DeepChart" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "mt5_live_bridge" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 300

if (-not (Test-Path $ReleaseOutDir)) {
    New-Item -ItemType Directory -Path $ReleaseOutDir -Force | Out-Null
}

# 1. Build Production Frontend Bundle
Write-Host "`n[1/4] Building production frontend assets (tsc + vite build)..." -ForegroundColor Yellow
Set-Location $DesktopDir
npm run build
if ($LASTEXITCODE -ne 0) {
    throw "Frontend build failed!"
}

# 2. Build Lightweight Optimized Tauri Release Binary (+ NSIS Installer if available)
Write-Host "`n[2/4] Compiling lightweight Windows desktop binary (Tauri 2 Release, LTO + strip)..." -ForegroundColor Yellow
$NsisInstallerPath = $null
try {
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -eq 0) {
        $nsisDir = Join-Path $TauriDir "target\release\bundle\nsis"
        if (Test-Path $nsisDir) {
            $foundSetup = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" | Select-Object -First 1
            if ($foundSetup) {
                $NsisInstallerPath = $foundSetup.FullName
            }
        }
    }
} catch {
    Write-Warning "Tauri NSIS bundler encountered an issue; verifying release .exe build..."
}

$ReleaseExe = Join-Path $TauriDir "target\release\deepchart-desktop.exe"
if (-not (Test-Path $ReleaseExe)) {
    Write-Host "Running direct Cargo release build (Tauri 2 embedded frontend)..." -ForegroundColor Yellow
    cargo build --release --manifest-path "$TauriDir\Cargo.toml"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ReleaseExe)) {
        throw "Failed to compile release executable deepchart-desktop.exe!"
    }
}

$exeSizeMb = [Math]::Round((Get-Item $ReleaseExe).Length / 1MB, 2)
Write-Host "Compiled lightweight executable: $ReleaseExe ($exeSizeMb MB)" -ForegroundColor Green

# 3. Assemble Release Distribution Package (Keeping Gate G6 compatibility + Real .EXE)
Write-Host "`n[3/4] Assembling Windows x64 distribution package..." -ForegroundColor Yellow
$PackageDir = Join-Path $ReleaseOutDir "DeepChart-v0.1.0-RC1-windows-x64"
if (Test-Path $PackageDir) {
    Remove-Item -Recurse -Force $PackageDir
}
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

# Copy real lightweight Windows standalone executable + required WebView2Loader.dll (Windows GNU runtime)
Copy-Item -Path $ReleaseExe -Destination (Join-Path $PackageDir "VluxChart-DeepChart.exe")
$WebView2Dll = Join-Path $TauriDir "target\release\WebView2Loader.dll"
if (Test-Path $WebView2Dll) {
    Copy-Item -Path $WebView2Dll -Destination (Join-Path $PackageDir "WebView2Loader.dll") -Force
}

# Copy optional lightweight MT5 bridge helper script next to executable
$ScriptsTarget = Join-Path $PackageDir "scripts"
New-Item -ItemType Directory -Path $ScriptsTarget -Force | Out-Null
Copy-Item -Path (Join-Path $ProjectRoot "scripts\mt5_live_bridge.py") -Destination (Join-Path $ScriptsTarget "mt5_live_bridge.py")

# Copy NSIS Setup installer if built
if ($NsisInstallerPath -and (Test-Path $NsisInstallerPath)) {
    $SetupDest = Join-Path $ReleaseOutDir "VluxChart-DeepChart-0.1.0-x64-setup.exe"
    Copy-Item -Path $NsisInstallerPath -Destination $SetupDest -Force
    $setupSizeMb = [Math]::Round((Get-Item $SetupDest).Length / 1MB, 2)
    Write-Host "Packaged NSIS Setup Installer: $SetupDest ($setupSizeMb MB)" -ForegroundColor Green
}

# Copy static frontend distribution & compliance/runbook docs
Copy-Item -Recurse -Path "$DesktopDir\dist" -Destination "$PackageDir\app-resources"
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

$Items = Get-ChildItem -Path $ReleaseOutDir -Recurse -File | Where-Object { $_.FullName -ne $ChecksumFile }
foreach ($item in $Items) {
    $hash = Get-FileHash -Path $item.FullName -Algorithm SHA256
    $relPath = $item.FullName.Substring($ReleaseOutDir.Length + 1).Replace("\", "/")
    "$($hash.Hash)  $relPath" | Out-File -Append -FilePath $ChecksumFile -Encoding utf8
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  Windows Release Build & Checksums SUCCESSFUL!" -ForegroundColor Green
Write-Host "  Executable Size: $exeSizeMb MB (Lightweight, On-Demand Data)" -ForegroundColor Green
Write-Host "  Portable Bundle: $PackageDir" -ForegroundColor Green
if ($NsisInstallerPath) {
    Write-Host "  NSIS Installer:  $(Join-Path $ReleaseOutDir 'VluxChart-DeepChart-0.1.0-x64-setup.exe')" -ForegroundColor Green
}
Write-Host "  SHA-256 File:    $ChecksumFile" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
