param([Parameter(Mandatory=$true)][string]$ProductionPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'process-identity.ps1')
$manifest = Join-Path $ProductionPath '.deploy/processes.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Run setup-server.ps1 -AdoptCurrentProcesses on the server first.' }
$targets = @(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
# Validate every identity before stopping anything. PID reuse must never kill another app.
foreach ($target in $targets) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($target.Id)"
    if ($process) {
        $actual = Get-AppProcessIdentity -Process $process -Port $target.Port
        Assert-AppProcessIdentity -Actual $actual -Saved $target
    }
}
foreach ($target in $targets) {
    if (Get-Process -Id $target.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $target.Id -ErrorAction Stop
        Wait-Process -Id $target.Id -Timeout 20 -ErrorAction SilentlyContinue
    }
}
