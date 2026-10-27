# Read-only readiness inspection. Does not print secrets, RTSP URLs, or .env values.
param([string] $ProductionPath = 'C:\Users\Axioo Pongo\Documents\XOORA\AI-Grading-Sugarcane')
$ErrorActionPreference = 'Continue'
Write-Host '=== PG TRANGKIL SERVER PRECHECK ==='
Write-Host "Production folder exists: $(Test-Path -LiteralPath $ProductionPath)"
Write-Host "Git tracked SHA:"
if (Test-Path -LiteralPath (Join-Path $ProductionPath '.git')) { & git -C $ProductionPath rev-parse --short HEAD }
foreach ($file in @('.env', 'scripts/start-public.ps1', 'scripts/resume-public.ps1', '.deploy/stop.ps1', '.deploy/start.ps1')) {
    Write-Host ("{0}: {1}" -f $file, (Test-Path -LiteralPath (Join-Path $ProductionPath $file)))
}
Write-Host 'Runner status:'
Get-Process -Name 'Runner.Listener','Runner.Worker' -ErrorAction SilentlyContinue | Select-Object ProcessName, Id
Write-Host 'App-related listening ports:'
Get-NetTCPConnection -State Listen -LocalPort 5432,4110,8010,8080 -ErrorAction SilentlyContinue |
    Select-Object LocalPort, OwningProcess
Write-Host 'Local health:'
try { Invoke-RestMethod -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 5 | Select-Object status,service }
catch { Write-Warning 'Local health endpoint did not respond.' }
Write-Host 'pg_dump availability:'
$pg = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
if ($pg) { Write-Host $pg.Source }
else { Write-Host 'Not on PATH (check C:\Program Files\PostgreSQL\18\bin\pg_dump.exe).' }
