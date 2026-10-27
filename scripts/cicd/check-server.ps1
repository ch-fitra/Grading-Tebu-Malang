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
    Select-Object LocalPort, OwningProcess | Format-Table -AutoSize
Write-Host 'Application process visibility (no command lines or credentials printed):'
foreach ($port in @(4110,8010)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { Write-Warning "Port $port has no listener."; continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $owner = if ($process) { Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction SilentlyContinue } else { $null }
    [pscustomobject]@{
        Port=$port; PID=$listener.OwningProcess; Name=$process.Name
        CommandLineReadable=(-not [string]::IsNullOrWhiteSpace($process.CommandLine))
        Owner=if ($owner -and $owner.ReturnValue -eq 0) { "$($owner.Domain)\$($owner.User)" } else { '(unavailable)' }
        CurrentUser=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    } | Format-List
}
Write-Host 'Local health:'
foreach ($port in @(4110,8010,8080)) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
        Write-Host "Port $port health status: $($response.status)"
    } catch { Write-Warning "Port $port health endpoint did not respond." }
}
Write-Host 'pg_dump availability:'
$pg = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
if ($pg) { Write-Host $pg.Source }
else {
    $candidates = @(Get-ChildItem -Path "$env:ProgramFiles\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue)
    if ($candidates.Count) { $candidates | ForEach-Object { Write-Host "Available: $($_.FullName)" } }
    else { Write-Warning 'pg_dump not found on PATH or under Program Files/PostgreSQL.' }
}
