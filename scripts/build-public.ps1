$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:VITE_API_URL = 'same-origin'
$env:VITE_WS_URL = 'same-origin'
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build publik gagal.' }
} finally {
    Remove-Item Env:VITE_API_URL,Env:VITE_WS_URL -ErrorAction SilentlyContinue
}
