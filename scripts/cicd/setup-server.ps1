[CmdletBinding()]
param(
    [string]$ProductionPath='C:\Users\Axioo Pongo\Documents\XOORA\AI-Grading-Sugarcane',
    [switch]$AdoptCurrentProcesses
)
$ErrorActionPreference='Stop'
if (-not (Test-Path -LiteralPath (Join-Path $ProductionPath '.env'))) { throw 'Production .env not found.' }
$destination=Join-Path $ProductionPath '.deploy'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
if ($AdoptCurrentProcesses) {
    $records=@(foreach ($port in @(4110,8010)) {
        $listener=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Select-Object -First 1
        $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        $expected=if ($port -eq 4110) {'node.exe'} else {'python.exe'}
        if (-not $process) { throw "Cannot inspect process $($listener.OwningProcess) on port $port." }
        if ($process.Name -ne $expected) { throw "Port $port is owned by '$($process.Name)' (PID $($process.ProcessId)); expected $expected. No process stopped." }
        if (-not $process.CommandLine) { throw "Cannot read command line of $expected PID $($process.ProcessId) on port $port. Run setup under the Windows account that started this application. No process stopped." }
        [pscustomobject]@{Port=$port;Id=$process.ProcessId;CommandLine=$process.CommandLine;CreationDate=$process.CreationDate.ToString('o')}
    })
    $records | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'processes.json') -Encoding UTF8
}
foreach ($name in @('start.ps1','stop.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $destination $name) -Force
}
Write-Host 'Hooks installed. No services restarted. Deployment remains subject to preflight checks.'
