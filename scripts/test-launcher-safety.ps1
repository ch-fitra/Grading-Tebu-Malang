$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'start-malang.ps1'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('malang-launcher-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $tempRoot 'scripts') -Force | Out-Null
$runtime = Join-Path $tempRoot '.runtime/malang'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $tempRoot 'scripts/start-malang.ps1')
$launcher = Join-Path $tempRoot 'scripts/start-malang.ps1'
try {
    $lock = [IO.File]::Open((Join-Path $runtime 'startup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try {
        $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -File $launcher 2>&1 | Out-String
    $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -eq 0 -or $output -notmatch 'Startup Malang lain') { throw 'Concurrent startup was not rejected' }
    } finally { $lock.Dispose() }
    Write-Host 'PASS: concurrent startup rejected before environment/database access'
    @{ Id=$PID } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'processes.json')
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -File $launcher 2>&1 | Out-String
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -eq 0 -or $output -notmatch 'Manifest masih menunjuk PID hidup') { throw 'Live PID was not protected' }
    if (-not (Test-Path -LiteralPath (Join-Path $runtime 'processes.json'))) { throw 'Live manifest was modified' }
    Write-Host 'PASS: live PID manifest preserved without stopping any process'
} finally {
    # Delete only the exact unique fixture directory created by this test.
    $resolved = [IO.Path]::GetFullPath($tempRoot)
    $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($resolved) -ne $expectedParent -or [IO.Path]::GetFileName($resolved) -notlike 'malang-launcher-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

