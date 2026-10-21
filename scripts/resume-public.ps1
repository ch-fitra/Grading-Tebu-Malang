$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'start-public.ps1')
& (Join-Path $PSScriptRoot 'connect-tunnel.ps1') -UseSavedToken
Write-Host 'Domain: https://pgtrangkil.aisugarcanembs.com'
Write-Host 'Hubungkan VPN jaringan CCTV jika diperlukan. Laptop dan koneksi internet harus tetap aktif.'
