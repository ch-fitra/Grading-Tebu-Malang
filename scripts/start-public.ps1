$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$runtime = Join-Path $projectRoot '.runtime'
function Listening([int]$port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}
if (-not (Listening 4110)) {
    Start-Process -FilePath 'node.exe' -ArgumentList 'dist/server.js' -WorkingDirectory (Join-Path $projectRoot 'apps/api') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'api.log') -RedirectStandardError (Join-Path $runtime 'api-error.log')
}
if (-not (Listening 8010)) {
    Start-Process -FilePath 'python.exe' -ArgumentList '-m','uvicorn','main:app','--app-dir','apps/ai-service','--host','127.0.0.1','--port','8010' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'ai.log') -RedirectStandardError (Join-Path $runtime 'ai-error.log')
}
$nginxRoot = Join-Path $runtime 'nginx-1.30.5'
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/nginx.conf') -Destination (Join-Path $nginxRoot 'conf/nginx.conf')
$nginxPrefix = $nginxRoot.Replace('\','/') + '/'
& (Join-Path $nginxRoot 'nginx.exe') -p $nginxPrefix -t
if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi Nginx tidak valid.' }
if (-not (Listening 8080)) {
    Start-Process -FilePath (Join-Path $nginxRoot 'nginx.exe') -ArgumentList '-p',$nginxPrefix -WorkingDirectory $nginxRoot -WindowStyle Hidden
}
Write-Host 'Gateway lokal: http://127.0.0.1:8080'
Write-Host 'Cloudflare Tunnel harus dijalankan terpisah menuju gateway ini.'
