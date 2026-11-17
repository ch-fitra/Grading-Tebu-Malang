param(
    [switch]$IncludeMobile,
    [string]$MobileApiUrl,
    [string]$MobileDeviceId,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previousEnv = @{}
function Set-ChildEnv([string]$key,[string]$value) {
    if (-not $previousEnv.ContainsKey($key)) { $previousEnv[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
    [Environment]::SetEnvironmentVariable($key,$value,'Process')
}
function Require-Success([string]$label) {
    if ($LASTEXITCODE -ne 0) { throw "$label gagal. Periksa output di atas." }
}
Push-Location -LiteralPath $projectRoot
try {
    if (Test-Path -LiteralPath (Join-Path $projectRoot '.runtime/malang/processes.json')) { throw 'Mode server Malang masih memiliki manifest. Jalankan npm run stop:malang sebelum dev:all.' }
    foreach ($port in @(4111,5176,8011)) {
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port Malang $port sedang dipakai. Proses yang ada tidak digunakan ulang atau dihentikan." }
    }
    foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot '.env')) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-ChildEnv $Matches[1] $Matches[2] }
    }
    if ($env:INSTALLATION_ID -ne 'malang') { throw 'Instalasi ini bukan Malang.' }
    if ($env:API_PORT -ne '4111' -or $env:AI_SERVICE_URL -ne 'http://127.0.0.1:8011') { throw 'Launcher demo Malang memakai API 4111 dan AI 8011. Periksa .env.' }
    Set-ChildEnv 'NODE_ENV' 'development'
    Set-ChildEnv 'API_HOST' $(if ($IncludeMobile) { '0.0.0.0' } else { '127.0.0.1' })
    Set-ChildEnv 'VITE_API_URL' 'same-origin'
    Set-ChildEnv 'VITE_BACKEND_URL' 'http://127.0.0.1:4111'
    Set-ChildEnv 'VITE_WS_URL' 'same-origin'
    Set-ChildEnv 'SUGARCANE_API_URL' 'http://127.0.0.1:4111'
    Set-ChildEnv 'SUGARCANE_AI_SERVICE_URL' 'http://127.0.0.1:8011'

    & node (Join-Path $PSScriptRoot 'check-databases.mjs')
    Require-Success 'Pemeriksaan database Malang'
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/concurrently/package.json'))) { throw 'Dependensi Node belum lengkap. Jalankan npm ci dahulu.' }
    $python = Join-Path $projectRoot '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $python)) { throw 'Python .venv Malang belum tersedia. Ikuti README untuk menyiapkannya.' }

    $commands = @(
        'npm run dev -w @sugarcane/api',
        'npm run dev -w @sugarcane/web',
        'npm run dev:ai',
        'npm run dev -w @sugarcane/desktop -- --reuse-web'
    )
    $names = 'api,web,ai,desktop'
    $colors = 'green,cyan,magenta,yellow'
    $mobileReady = $false
    if ($IncludeMobile) {
        $flutter = Join-Path $projectRoot '.toolchains/flutter/bin/flutter.bat'
        if (-not (Test-Path -LiteralPath $flutter)) {
            $flutterCommand = Get-Command flutter -ErrorAction SilentlyContinue
            $flutter = if ($flutterCommand) { $flutterCommand.Source } else { $null }
        }
        if (-not $flutter) { throw 'Flutter belum tersedia. Pasang Flutter atau tambahkan ke PATH.' }
        $devices = @(& $flutter devices --machine 2>$null | ConvertFrom-Json | Where-Object { $_.targetPlatform -match '^android' })
        Require-Success 'Pencarian perangkat Android'
        $device = if ($MobileDeviceId) { $devices | Where-Object id -eq $MobileDeviceId | Select-Object -First 1 } else { $devices | Select-Object -First 1 }
        if (-not $device) {
            if (-not $CheckOnly) { throw 'Android belum terdeteksi. Hubungkan ponsel dengan USB debugging aktif atau nyalakan emulator, lalu ulangi -IncludeMobile.' }
            Write-Warning 'Pemeriksaan saja: Android belum terdeteksi; Flutter belum dapat dijalankan ke perangkat.'
        } else {
            if ($device.id -notmatch '^[A-Za-z0-9_.:-]+$') { throw 'ID perangkat Android tidak valid.' }
            if ([string]::IsNullOrWhiteSpace($MobileApiUrl)) {
                if ($device.emulator) { $MobileApiUrl = 'http://10.0.2.2:4111' }
                else {
                    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and $_.InterfaceAlias -notmatch 'Tailscale|Loopback|Docker|vEthernet' })
                    $selected = $addresses | Sort-Object @{Expression={if ($_.InterfaceAlias -match 'Wi-Fi|WLAN|Wireless') {0} else {1}}} | Select-Object -First 1
                    if ($selected) { $MobileApiUrl = "http://$($selected.IPAddress):4111" }
                }
            }
            $parsedUrl = $null
            if (-not [Uri]::TryCreate($MobileApiUrl,[UriKind]::Absolute,[ref]$parsedUrl) -or $parsedUrl.Scheme -notin @('http','https') -or $parsedUrl.UserInfo -or $parsedUrl.Query -or $parsedUrl.Fragment) { throw 'MobileApiUrl harus alamat dasar HTTP/HTTPS tanpa kredensial, query atau fragment.' }
            $safeUrl = $parsedUrl.AbsoluteUri.TrimEnd('/')
            $commands += "cd /d `"$projectRoot\apps\mobile`" && `"$flutter`" run -d $($device.id) --dart-define=API_BASE_URL=`"$safeUrl`""
            $names += ',mobile'
            $colors += ',blue'
            $mobileReady = $true
            Write-Host "Mobile Android: $($device.id); API $safeUrl"
        }
    }
    Write-Host 'Malang: web http://127.0.0.1:5176, API 4111, AI 8011, desktop memakai UI Malang yang sama.'
    if (-not $IncludeMobile) { Write-Host 'Tambahkan -- -IncludeMobile untuk menjalankan Flutter ke Android.' }
    if ($CheckOnly) {
        Write-Host "Pemeriksaan selesai. Rencana: $names. Mobile siap: $mobileReady. Tidak ada layanan atau aplikasi klien yang dijalankan."
    } else {
        & $python -c 'import uvicorn, cv2, psycopg2, fastapi'
        Require-Success 'Dependensi AI Malang'
        & node (Join-Path $projectRoot 'apps/desktop/scripts/ensure-electron.cjs')
        Require-Success 'Runtime desktop Electron'
        & npm.cmd run db:migrate
        Require-Success 'Migrasi database Malang'
        if ($mobileReady) {
            Push-Location -LiteralPath (Join-Path $projectRoot 'apps/mobile')
            try { & $flutter pub get; Require-Success 'Dependensi mobile' } finally { Pop-Location }
        }
        Write-Host 'Menjalankan klien Malang. Tekan Ctrl+C pada terminal ini untuk menghentikan seluruh proses dev:all miliknya.'
        & npx.cmd --no-install concurrently --kill-others --names $names --prefix-colors $colors @commands
        Require-Success 'Sesi dev:all Malang'
    }
} finally {
    foreach ($key in $previousEnv.Keys) { [Environment]::SetEnvironmentVariable($key,$previousEnv[$key],'Process') }
    Pop-Location
}
