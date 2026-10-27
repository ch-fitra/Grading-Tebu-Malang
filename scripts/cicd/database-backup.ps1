function Read-DotEnvValue([string] $Name, [string] $EnvPath) {
    $entry = Get-Content -LiteralPath $EnvPath | Where-Object { $_ -match ('^\s*(?:export\s+)?' + [regex]::Escape($Name) + '\s*=') } | Select-Object -Last 1
    if (-not $entry) { return $null }
    $value = ($entry -replace ('^\s*(?:export\s+)?' + [regex]::Escape($Name) + '\s*='), '').Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    return $value
}

function Locate-PgDump {
    $cmd = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $pgFolder = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path -LiteralPath $pgFolder) {
        $versions = @(Get-ChildItem -LiteralPath $pgFolder -Directory -ErrorAction SilentlyContinue |
            Sort-Object { [int]($_.Name -replace '[^0-9]', '') } -Descending)
        foreach ($versionFolder in $versions) {
            $candidate = Join-Path $versionFolder.FullName 'bin\pg_dump.exe'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
        }
    }
    throw 'pg_dump not found. Cannot safely deploy without database backups.'
}

function Backup-Database([string] $Url, [string] $TargetFile, [string] $PgDumpExe) {
    Require ($Url -match '^postgres(?:ql)?://') 'Database URL must be a PostgreSQL URI.'
    $uri = [System.Uri] $Url
    $divider = $uri.UserInfo.IndexOf(':')
    Require ($divider -ge 1) 'Database URI must contain a username and password for a non-interactive backup.'
    $user = [System.Uri]::UnescapeDataString($uri.UserInfo.Substring(0, $divider))
    $password = [System.Uri]::UnescapeDataString($uri.UserInfo.Substring($divider + 1))
    $dbName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
    Require (-not [string]::IsNullOrWhiteSpace($dbName)) 'Database name is missing in database URL.'
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    $previousPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $password
        $args = @('--host', $uri.Host, '--port', [string] $port, '--username', $user,
                  '--dbname', $dbName, '--format', 'custom', '--no-password', '--file', $TargetFile)
        & $PgDumpExe @args *> $null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $TargetFile)) {
            throw 'pg_dump returned an error. Deployment has NOT started.'
        }
        Require ((Get-Item -LiteralPath $TargetFile).Length -gt 0) 'pg_dump returned an empty backup.'
    }
    finally { $env:PGPASSWORD = $previousPassword }
}

