$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

# Gracefully terminate any running instances so Windows file locks are released
Get-Process -Name "deepchart-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$winlibs = "C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
if (Test-Path $winlibs) {
    $cargo = "$env:USERPROFILE\.cargo\bin"
    $cleanPaths = ($env:PATH -split ';') | Where-Object { 
        $_ -and 
        $_ -notmatch "MinGW" -and 
        $_ -notmatch "llvm-mingw" -and 
        $_ -notmatch "BrechtSanders"
    }
    $env:PATH = "$winlibs;$cargo;" + ($cleanPaths -join ';')
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Checking DeepChart Desktop Terminal (Tauri Dev Mode)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
