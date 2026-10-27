[CmdletBinding()]
param(
    [string]$ProductionPath='C:\Users\Axioo Pongo\Documents\XOORA\AI-Grading-Sugarcane',
    [switch]$Restart
)
$ErrorActionPreference='Stop'
$hooks=Join-Path $ProductionPath '.deploy'
foreach ($name in @('start.ps1','stop.ps1','process-identity.ps1','processes.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $hooks $name))) { throw "Missing .deploy/$name" }
}
. (Join-Path $hooks 'process-identity.ps1')
$targets=@(Get-Content -LiteralPath (Join-Path $hooks 'processes.json') -Raw | ConvertFrom-Json)
if ($targets.Count -ne 2 -or @($targets.Port | Sort-Object -Unique).Count -ne 2 -or @($targets | Where-Object { $_.Port -notin @(4110,8010) }).Count) { throw 'Invalid application process manifest.' }
foreach ($target in $targets) {
    $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.Id)"
    $actual=Get-AppProcessIdentity -Process $process -Port $target.Port
    Assert-AppProcessIdentity -Actual $actual -Saved $target
}
& node (Join-Path $PSScriptRoot 'check-idle.mjs') $ProductionPath
if ($LASTEXITCODE -ne 0) { throw 'Restart blocked: idle check failed.' }
foreach ($required in @('apps/api/dist/server.js','apps/web/dist/index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProductionPath $required))) { throw "Missing $required. No services stopped." }
}
Write-Host 'PASS process identity, idle state and existing build.'
if (-not $Restart) { Write-Host 'Read-only checks complete. Use -Restart only during an operator maintenance window.'; return }
function Test-LocalHealth {
    foreach ($port in @(4110,8010,8080)) {
        $response=Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 10
        if ($response.status -ne 'ok') { throw "Port $port is not healthy." }
        Write-Host "PASS health $port"
    }
}
try {
    Write-Host 'Restarting API and AI using the existing build. No Git checkout, install or migration.'
    & (Join-Path $hooks 'stop.ps1') -ProductionPath $ProductionPath
    & (Join-Path $hooks 'start.ps1') -ProductionPath $ProductionPath
    Test-LocalHealth
    Write-Host 'RESTART TEST PASSED. This does not test deployment rollback or database restore.'
} catch {
    Write-Warning 'Restart failed; attempting to start the existing application again.'
    try {
        & (Join-Path $hooks 'start.ps1') -ProductionPath $ProductionPath
        Test-LocalHealth
        Write-Warning 'Existing application started. Restart test still failed; review the original error.'
    } catch { Write-Warning 'Recovery failed. Inspect .runtime/api-error.log and .runtime/ai-error.log on the server.' }
    throw
}
