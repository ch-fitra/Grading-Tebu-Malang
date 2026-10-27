function Get-AppProcessIdentity($Process, [int]$Port) {
    if (-not $Process -or -not $Process.CreationDate) { throw "Cannot identify process on port $Port" }
    $expected = if ($Port -eq 4110) { 'node.exe' } elseif ($Port -eq 8010) { 'python.exe' } else { throw 'Unsupported application port' }
    if ($Process.Name -ne $expected) { throw "Unexpected process name on port $Port" }
    $owner = Invoke-CimMethod -InputObject $Process -MethodName GetOwnerSid -ErrorAction Stop
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $currentSid) { throw "Process on port $Port must belong to the current Windows account." }
    [pscustomobject]@{ Port=$Port; Id=$Process.ProcessId; Name=$Process.Name; OwnerSid=$owner.Sid; CreationDate=$Process.CreationDate.ToUniversalTime().ToString('o') }
}

function Assert-AppProcessIdentity($Actual, $Saved) {
    if ($Actual.Id -ne $Saved.Id -or $Actual.Name -ne $Saved.Name -or $Actual.OwnerSid -ne $Saved.OwnerSid -or $Actual.CreationDate -ne $Saved.CreationDate) {
        throw "Process identity changed for port $($Saved.Port); inspect server before retrying."
    }
}

function Read-AppProcessManifest([string]$Path) {
    # Windows PowerShell 5.1 emits a JSON array as one pipeline object.
    # Assign first, then enumerate explicitly; @(... | ConvertFrom-Json) nests it.
    $parsed = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $Path -Raw)
    $entries = @($parsed)
    $ports = @($entries | ForEach-Object { [int]$_.Port } | Sort-Object)
    if ($entries.Count -ne 2 -or ($ports -join ',') -ne '4110,8010') {
        throw 'Invalid application process manifest: expected one entry each for ports 4110 and 8010. Run setup-server.ps1 -AdoptCurrentProcesses.'
    }
    foreach ($entry in $entries) {
        if (-not $entry.Id -or -not $entry.Name -or -not $entry.OwnerSid -or -not $entry.CreationDate) {
            throw 'Incomplete application process manifest. Run setup-server.ps1 -AdoptCurrentProcesses.'
        }
        $entry
    }
}
