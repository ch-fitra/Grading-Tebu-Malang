$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'process-identity.ps1')
$testFile=[IO.Path]::GetTempFileName()
try {
    $valid=@(
        [pscustomobject]@{Port=4110;Id=123;Name='node.exe';OwnerSid='test';CreationDate='2026-10-27'},
        [pscustomobject]@{Port=8010;Id=456;Name='python.exe';OwnerSid='test';CreationDate='2026-10-27'}
    )
    $valid | ConvertTo-Json | Set-Content -LiteralPath $testFile
    $actual=@(Read-AppProcessManifest $testFile)
    if ($actual.Count -ne 2 -or $actual[0].Id -ne 123 -or $actual[1].Id -ne 456) { throw 'Valid JSON manifest failed to enumerate.' }
    Write-Host 'PASS valid JSON array enumerates as two process records'
    foreach ($case in @('duplicate-port','missing-entry','missing-identity','extra-entry')) {
        $entries=@($valid | ForEach-Object { $_.PSObject.Copy() })
        switch ($case) {
            'duplicate-port' { $entries[1].Port=4110 }
            'missing-entry' { $entries=@($entries[0]) }
            'missing-identity' { $entries[0].OwnerSid=$null }
            'extra-entry' { $entries+= $entries[0] }
        }
        ConvertTo-Json -InputObject $entries | Set-Content -LiteralPath $testFile
        $rejected=$false
        try { Read-AppProcessManifest $testFile | Out-Null } catch { $rejected=$true }
        if (-not $rejected) { throw "Invalid manifest accepted: $case" }
        Write-Host "PASS rejects $case"
    }
} finally { Remove-Item -LiteralPath $testFile -Force }
