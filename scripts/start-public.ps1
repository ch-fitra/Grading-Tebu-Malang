param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$runtime = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

function Listening([int]$port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}
function Wait-Health([string]$url, [string]$label) {
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        try {
            $status = Invoke-RestMethod -Uri $url -TimeoutSec 2
            if ($status.status -eq 'ok') { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "$label belum siap. Periksa log di .runtime dan konfigurasi .env."
}

$nginx = Get-ChildItem -LiteralPath $runtime -Directory -Filter 'nginx-*' |
    Where-Object { $_.Name -match '^nginx-\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'nginx.exe')) } |
    Sort-Object { [version]($_.Name -replace '^nginx-', '') } -Descending |
    Select-Object -First 1
if (-not $nginx) { throw 'Nginx belum tersedia. Jalankan scripts/setup-public.ps1 terlebih dahulu.' }
foreach ($required in @('.env', 'apps/web/dist/index.html', 'apps/api/dist/server.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $required))) {
        throw "File $required belum tersedia. Siapkan .env dan jalankan scripts/build-public.ps1."
    }
}

$nginxRoot = $nginx.FullName
$nginxExecutable = Join-Path $nginxRoot 'nginx.exe'
$webRoot = (Join-Path $projectRoot 'apps/web/dist').Replace('\', '/')
$template = [IO.File]::ReadAllText((Join-Path $projectRoot 'deploy/nginx.conf'))
[IO.File]::WriteAllText((Join-Path $nginxRoot 'conf/nginx.conf'), $template.Replace('__WEB_ROOT__', $webRoot), [Text.UTF8Encoding]::new($false))
$nginxPrefix = $nginxRoot.Replace('\', '/') + '/'
& $nginxExecutable -p $nginxPrefix -t
if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi Nginx tidak valid.' }
if ($CheckOnly) {
    Write-Host 'Konfigurasi deployment valid. Tidak ada layanan yang dinyalakan atau direload.'
    return
}

# The inherited environment overrides development values loaded from .env.
$env:NODE_ENV = 'production'
$env:API_HOST = '127.0.0.1'
$env:API_PORT = '4110'
if (-not (Listening 4110)) {
    Start-Process -FilePath 'node.exe' -ArgumentList 'dist/server.js' -WorkingDirectory (Join-Path $projectRoot 'apps/api') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'api.log') -RedirectStandardError (Join-Path $runtime 'api-error.log') | Out-Null
} else {
    Write-Host 'API port 4110 sudah aktif; proses yang ada dipakai. Hentikan dev:web sebelum beralih ke mode publik.'
}
if (-not (Listening 8010)) {
    $python = Join-Path $projectRoot '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $python)) { $python = (Get-Command python.exe -ErrorAction Stop).Source }
    Start-Process -FilePath $python -ArgumentList '-m','uvicorn','main:app','--app-dir','apps/ai-service','--host','127.0.0.1','--port','8010' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'ai.log') -RedirectStandardError (Join-Path $runtime 'ai-error.log') | Out-Null
}
Wait-Health 'http://127.0.0.1:4110/health' 'API'
Wait-Health 'http://127.0.0.1:8010/health' 'AI'

# Start-Process joins ArgumentList with spaces: explicitly quote the prefix.
$prefixArgument = '"' + $nginxPrefix + '"'
if (Listening 8080) {
    $listener = Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object -First 1
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    if ($owner.Path -ne $nginxExecutable) { throw 'Port 8080 dipakai proses/gateway lain. Hentikan gateway lama sebelum menjalankan yang baru.' }
    & $nginxExecutable -p $nginxPrefix -s reload
    if ($LASTEXITCODE -ne 0) { throw 'Reload Nginx gagal. Periksa .runtime/nginx-*/logs/error.log.' }
} else {
    Start-Process -FilePath $nginxExecutable -ArgumentList '-p',$prefixArgument -WorkingDirectory $nginxRoot -WindowStyle Hidden | Out-Null
}
Wait-Health 'http://127.0.0.1:8080/health' 'Gateway'
Write-Host 'Gateway lokal siap: http://127.0.0.1:8080'
Write-Host 'Lanjutkan dengan scripts/connect-tunnel.ps1 untuk domain publik.'
