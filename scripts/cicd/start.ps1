param([Parameter(Mandatory=$true)][string]$ProductionPath)
$ErrorActionPreference = 'Stop'
# Only application children must survive Actions' job cleanup.
$tracking = $env:RUNNER_TRACKING_ID
try {
    Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue
    & (Join-Path $ProductionPath 'scripts/start-public.ps1')
    $processes = @(foreach ($port in @(4110,8010)) {
        $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if (-not $process.CommandLine) { throw "Cannot identify process on port $port" }
        [pscustomobject]@{ Port=$port; Id=$process.ProcessId; CommandLine=$process.CommandLine; CreationDate=$process.CreationDate.ToString('o') }
    })
    $processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ProductionPath '.deploy/processes.json') -Encoding UTF8
} finally { $env:RUNNER_TRACKING_ID = $tracking }
