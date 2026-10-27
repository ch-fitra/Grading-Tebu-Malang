param([Parameter(Mandatory=$true)][string]$ProductionPath)
$ErrorActionPreference = 'Stop'
$manifest = Join-Path $ProductionPath '.deploy/processes.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Run setup-server.ps1 -AdoptCurrentProcesses on the server first.' }
$targets = @(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
# Validate every identity before stopping anything. PID reuse must never kill another app.
foreach ($target in $targets) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($target.Id)"
    if ($process -and ($process.CommandLine -ne $target.CommandLine -or $process.CreationDate.ToString('o') -ne $target.CreationDate)) {
        throw "Process identity changed for port $($target.Port); inspect server before retrying."
    }
}
foreach ($target in $targets) {
    if (Get-Process -Id $target.Id -ErrorAction SilentlyContinue) {
        Stop-Process -Id $target.Id -ErrorAction Stop
        Wait-Process -Id $target.Id -Timeout 20 -ErrorAction SilentlyContinue
    }
}
