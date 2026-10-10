$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'start-public.ps1')
$runtime = Join-Path $projectRoot '.runtime'
$tokenFile = Join-Path $runtime 'tunnel-token.txt'
if (-not (Test-Path -LiteralPath $tokenFile)) { throw 'Token belum tersedia. Jalankan scripts/connect-tunnel.ps1 terlebih dahulu.' }
$running = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object { $_.CommandLine -like '*--token-file*' }
if (-not $running) {
    Start-Process -FilePath (Join-Path $runtime 'cloudflared.exe') -ArgumentList 'tunnel','--protocol','http2','--no-autoupdate','run','--token-file',$tokenFile -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'named-tunnel.log') -RedirectStandardError (Join-Path $runtime 'named-tunnel-error.log')
}
Write-Host 'Domain: https://pgtrangkil.aisugarcanembs.com'
Write-Host 'Hubungkan FortiClient profil PGTK untuk mengakses CCTV Trangkil.'
