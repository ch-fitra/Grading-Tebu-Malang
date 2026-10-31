param([string]$Python = '', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $projectRoot '.runtime/malang'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$manifest = Join-Path $runtime 'processes.json'
if (Test-Path -LiteralPath $manifest) { throw 'Manifest Malang sudah ada. Jalankan stop-malang.ps1 sebelum start ulang.' }
foreach ($port in @(4111,8011,8081)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port Malang $port sedang dipakai. Tidak ada proses yang dihentikan atau digunakan ulang." }
}
if (-not $Python) {
    $venvPython = Join-Path $projectRoot '.venv/Scripts/python.exe'
    $Python = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { (Get-Command python -ErrorAction Stop).Source }
}
$node = (Get-Command node -ErrorAction Stop).Source
Push-Location -LiteralPath $projectRoot
$records = @()
$previousEnv = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot '.env')) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $key=$Matches[1]; $value=$Matches[2]
        $previousEnv[$key]=[Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key,$value,'Process')
    }
}
function Record-Process($process, $kind) {
    $identity = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
    if (-not $identity) { throw "Proses $kind berhenti sebelum siap; periksa log Malang." }
    if ($identity.CommandLine.Replace('/','\').IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw "Proses $kind tidak memiliki identitas folder Malang." }
    $script:records += [pscustomobject]@{ Id=$process.Id; Kind=$kind; Executable=$identity.ExecutablePath; Created=$identity.CreationDate.ToUniversalTime().ToString('o'); Command=$identity.CommandLine }
    $script:records | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifest -Encoding UTF8
}
function Wait-Malang($port) {
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        try {
            $result = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2
            if ($result.installation -eq 'malang' -and $result.status -eq 'ok') { return }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    throw "Layanan Malang port $port belum siap; periksa $runtime"
}
try {
    if (-not $SkipBuild) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build gagal' } }
    & $Python -c 'import uvicorn, cv2, psycopg2, fastapi, keras, torch'; if ($LASTEXITCODE -ne 0) { throw 'Dependensi Python belum lengkap. Pasang requirements di .venv Malang.' }
    $api = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $projectRoot 'apps/api/dist/server.js') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'api.log') -RedirectStandardError (Join-Path $runtime 'api-error.log')
    Record-Process $api 'api'; Wait-Malang 4111
    $aiArgs = @('-m','uvicorn','main:app','--app-dir',('"' + (Join-Path $projectRoot 'apps/ai-service') + '"'),'--host','127.0.0.1','--port','8011')
    $ai = Start-Process -FilePath $Python -ArgumentList $aiArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'ai.log') -RedirectStandardError (Join-Path $runtime 'ai-error.log')
    Record-Process $ai 'ai'; Wait-Malang 8011
    # Windows venv python.exe can be a launcher with a child interpreter.
    # Track the actual listener as well so stopping never leaves an orphan AI.
    $aiListener = Get-NetTCPConnection -State Listen -LocalPort 8011 | Select-Object -First 1
    if ($aiListener.OwningProcess -ne $ai.Id) {
        $childIdentity = Get-CimInstance Win32_Process -Filter "ProcessId=$($aiListener.OwningProcess)"
        if ($childIdentity.ParentProcessId -ne $ai.Id) { throw 'Listener AI bukan anak proses Malang yang baru dijalankan.' }
        ($records | Where-Object { $_.Id -eq $ai.Id }).Kind = 'ai-launcher'
        Record-Process (Get-Process -Id $aiListener.OwningProcess) 'ai'
    }
    & $node (Join-Path $PSScriptRoot 'configure-malang-gateway.mjs'); if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi gateway gagal' }
    $nginx = Join-Path $projectRoot '.runtime/nginx-1.30.6/nginx.exe'
    $prefix = ($runtime.Replace('\','/') + '/')
    & $nginx -t -p $prefix -c conf/nginx.conf; if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi Nginx tidak valid' }
    $gateway = Start-Process -FilePath $nginx -ArgumentList @('-p',('"'+$prefix+'"'),'-c','conf/nginx.conf') -WorkingDirectory $runtime -WindowStyle Hidden -PassThru
    Record-Process $gateway 'gateway'; Wait-Malang 8081
    Write-Host 'Malang siap: http://127.0.0.1:8081. Trangkil tidak diubah.'
} catch {
    Write-Warning 'Startup Malang gagal. Membersihkan hanya proses dalam manifest Malang.'
    if (Test-Path -LiteralPath $manifest) { & (Join-Path $PSScriptRoot 'stop-malang.ps1') }
    throw
} finally {
    foreach ($key in $previousEnv.Keys) { [Environment]::SetEnvironmentVariable($key,$previousEnv[$key],'Process') }
    Pop-Location
}
