$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

$nginxVersion = '1.30.6'
$nginxRoot = Join-Path $runtime "nginx-$nginxVersion"
if (-not (Test-Path -LiteralPath (Join-Path $nginxRoot 'nginx.exe'))) {
    $archive = Join-Path $runtime "nginx-$nginxVersion.zip"
    Write-Host "Mengunduh Nginx $nginxVersion dari nginx.org..."
    Invoke-WebRequest -Uri "https://nginx.org/download/nginx-$nginxVersion.zip" -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    Remove-Item -LiteralPath $archive
}

$cloudflared = Join-Path $runtime 'cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflared)) {
    Write-Host 'Mengunduh cloudflared Windows x64 dari rilis resmi Cloudflare...'
    $download = Join-Path $runtime 'cloudflared.download'
    Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $download -UseBasicParsing
    Move-Item -LiteralPath $download -Destination $cloudflared
}

Write-Host 'Nginx dan cloudflared tersedia di .runtime. File lokal yang sudah ada dipertahankan.'
Write-Host 'Lanjutkan: scripts/build-public.ps1, scripts/start-public.ps1, lalu scripts/connect-tunnel.ps1.'
