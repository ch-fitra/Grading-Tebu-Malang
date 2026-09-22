param(
  [string]$MobileApiUrl
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Require-Success([string]$label) {
  if ($LASTEXITCODE -ne 0) { throw "$label gagal. Periksa output di atas." }
}

Set-Location $root

Write-Host "[1/3] Memeriksa PostgreSQL..." -ForegroundColor Cyan
$postgresRunning = $null -ne (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $postgresRunning) {
  & docker compose up -d postgres
  Require-Success "PostgreSQL"
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    $health = (& docker inspect --format '{{.State.Health.Status}}' sugarcane-postgres 2>$null).Trim()
    if ($health -eq "healthy") { $postgresRunning = $true; break }
    Start-Sleep -Seconds 2
  }
}
if (-not $postgresRunning) { throw "PostgreSQL belum siap. Nyalakan Docker Desktop atau service PostgreSQL, lalu ulangi perintah." }

Write-Host "[2/3] Menerapkan migrasi database..." -ForegroundColor Cyan
& npm.cmd run db:migrate
Require-Success "Migrasi database"

# API perlu terbuka ke Wi-Fi/LAN agar aplikasi di ponsel fisik dapat terhubung.
$env:API_HOST = "0.0.0.0"

$flutter = Join-Path $root ".toolchains\flutter\bin\flutter.bat"
if (-not (Test-Path $flutter)) {
  $flutterCommand = Get-Command flutter -ErrorAction SilentlyContinue
  if ($null -eq $flutterCommand) { throw "Flutter tidak ditemukan. Instal Flutter atau sediakan .toolchains\\flutter." }
  $flutter = $flutterCommand.Source
}

if ([string]::IsNullOrWhiteSpace($MobileApiUrl)) {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and
    $_.InterfaceAlias -notmatch 'Tailscale|Loopback|Docker|vEthernet'
  }
  $wireless = $addresses | Where-Object { $_.InterfaceAlias -match 'Wi-Fi|WLAN|Wireless' } | Select-Object -First 1
  $selectedAddress = if ($wireless) { $wireless } else { $addresses | Select-Object -First 1 }
  if ($selectedAddress) { $MobileApiUrl = "http://$($selectedAddress.IPAddress):4110" }
}

$device = $null
try {
  $device = (& $flutter devices --machine 2>$null | ConvertFrom-Json | Where-Object { $_.targetPlatform -eq "android" } | Select-Object -First 1).id
} catch { $device = $null }

$commands = @(
  "npm run dev -w @sugarcane/api",
  "npm run dev -w @sugarcane/web",
  "npm run dev:ai",
  "npm run dev:desktop"
)
$names = "api,web,ai,desktop"
$colors = "green,cyan,magenta,yellow"

if ($device) {
  $mobileCommand = "cd /d `"$root\apps\mobile`" && `"$flutter`" run -d $device --dart-define=API_BASE_URL=$MobileApiUrl"
  $commands += $mobileCommand
  $names += ",mobile"
  $colors += ",blue"
  Write-Host "[3/3] Menjalankan semua klien. Mobile memakai $MobileApiUrl pada perangkat $device." -ForegroundColor Green
} else {
  Write-Host "[3/3] Menjalankan API, web, AI, dan desktop. Tidak ada Android terdeteksi; pasang APK atau hubungkan ponsel lalu ulangi perintah ini." -ForegroundColor Yellow
  if ($MobileApiUrl) { Write-Host "Alamat mobile yang direkomendasikan: $MobileApiUrl" -ForegroundColor Yellow }
}

& npx.cmd concurrently --names $names --prefix-colors $colors @commands
exit $LASTEXITCODE
