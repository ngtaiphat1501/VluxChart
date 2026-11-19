$winlibs = "C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
$cargo = "$env:USERPROFILE\.cargo\bin"
$cleanPaths = ($env:PATH -split ';') | Where-Object { 
    $_ -and 
    $_ -notmatch "MinGW" -and 
    $_ -notmatch "llvm-mingw" -and 
    $_ -notmatch "BrechtSanders"
}
$env:PATH = "$winlibs;$cargo;" + ($cleanPaths -join ';')
cargo test --workspace
