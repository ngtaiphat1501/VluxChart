$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

# Gracefully terminate any running instances so Windows file locks are released
try {
    cmd /c "taskkill /F /IM deepchart-desktop.exe /T >nul 2>&1"
} catch {}
Get-Process -Name "deepchart-desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# Automatically release port 1420 if previously held by a stale background process
try {
    $port1420 = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
    if ($port1420) {
        $pids = $port1420 | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pidToKill in $pids) {
            try { Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue } catch {}
        }
        Start-Sleep -Milliseconds 600
    }
} catch {}

# Optional MinGW / WinLibs PATH adaptation if present on host
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
Write-Host "  Launching DeepChart Windows Desktop Terminal (Tauri 2)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

npm --prefix apps/desktop run tauri dev
