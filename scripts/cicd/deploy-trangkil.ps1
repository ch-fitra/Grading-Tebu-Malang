# PG Trangkil only. Designed for Windows PowerShell 5.1 on a GitHub self-hosted runner.
# This script deliberately refuses to deploy if safe restart hooks are not configured.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $ProductionPath,
    [Parameter(Mandatory = $true)][string] $ExpectedSha,
    [switch] $PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function GitText([string[]] $Arguments) {
    $output = & git -C $ProductionPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('git command failed: git ' + ($Arguments -join ' '))
    }
    return (($output | Out-String).Trim())
}

function Invoke-Git([string[]] $Arguments) {
    & git -C $ProductionPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('git command failed: git ' + ($Arguments -join ' '))
    }
}

function Invoke-Npm([string[]] $Arguments) {
    Push-Location -LiteralPath $ProductionPath
    try {
        & npm.cmd @Arguments
        if ($LASTEXITCODE -ne 0) { throw ('npm command failed: npm ' + ($Arguments -join ' ')) }
    }
    finally { Pop-Location }
}

function Assert-Health {
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 5
            $ai = Invoke-RestMethod -Uri 'http://127.0.0.1:8010/health' -TimeoutSec 5
            if ($response.status -eq 'ok' -and $ai.status -eq 'ok') {
                Write-Host 'PASS local API and AI health'
                return
            }
        }
        catch { }
        Start-Sleep -Seconds 4
    }
    throw 'Local API or AI health check failed (8080/8010).'
}

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

Require (Test-Path -LiteralPath $ProductionPath -PathType Container) 'Production folder does not exist.'
Require ($ExpectedSha -match '^[0-9a-fA-F]{40}$') 'ExpectedSha must be a 40-character Git commit SHA.'
Require (-not [string]::IsNullOrWhiteSpace($env:GITHUB_WORKSPACE)) 'This script requires a GitHub Actions checkout workspace.'
Require (Test-Path -LiteralPath (Join-Path $env:GITHUB_WORKSPACE '.git')) 'The GitHub Actions checkout is not present.'
Require (Test-Path -LiteralPath (Join-Path $ProductionPath '.git')) 'Production folder is not a Git working tree.'

$envPath = Join-Path $ProductionPath '.env'
$hooksPath = Join-Path $ProductionPath '.deploy'
$stopHook = Join-Path $hooksPath 'stop.ps1'
$startHook = Join-Path $hooksPath 'start.ps1'
Require (Test-Path -LiteralPath $envPath -PathType Leaf) 'Missing production .env. Stopping.'
Require (Test-Path -LiteralPath $stopHook -PathType Leaf) 'Missing .deploy/stop.ps1. Configure actual service stop hook first.'
Require (Test-Path -LiteralPath $startHook -PathType Leaf) 'Missing .deploy/start.ps1. Configure actual service start hook first.'

$trackedSensitive = GitText @('ls-files', '--', '.env', '.deploy', '.runtime', 'backup/malang', '*.pt', '*.keras', '*.h5', '*.onnx')
Require ([string]::IsNullOrWhiteSpace($trackedSensitive)) ('Server contains Git-tracked local/runtime/model paths; cannot guarantee their protection: ' + $trackedSensitive)
$dirty = GitText @('status', '--porcelain', '--untracked-files=no')
Require ([string]::IsNullOrWhiteSpace($dirty)) 'Production has uncommitted tracked changes. Resolve these before deploying.'

$oldSha = GitText @('rev-parse', 'HEAD')
$workspaceSha = (& git -C $env:GITHUB_WORKSPACE rev-parse HEAD | Out-String).Trim()
Require ($LASTEXITCODE -eq 0 -and $workspaceSha -eq $ExpectedSha) 'Runner checkout SHA does not match requested commit.'

# Transfer the verified checkout through the local file system; no credentials are needed by production Git.
Invoke-Git @('fetch', '--no-tags', '--', $env:GITHUB_WORKSPACE, 'HEAD')
$newSha = GitText @('rev-parse', 'FETCH_HEAD')
Require ($newSha -eq $ExpectedSha) 'Fetched commit does not match the verified Actions commit.'

if ($oldSha -eq $newSha) {
    Write-Host 'Production is already at the requested commit. No restart needed.'
    exit 0
}

$changedText = GitText @('diff', '--name-only', $oldSha, $newSha)
$changed = @(($changedText -split "`n") | Where-Object { $_.Trim().Length -gt 0 })
$blocked = @($changed | Where-Object {
    $_ -match '^(database/|apps/ai-service/db/|apps/ai-service/models/|backup/malang/|\.runtime/)' -or
    $_ -match '(^|/)(config\.json|frame_config\.json|\.env)$' -or
    $_ -eq 'storage/roi_config.json' -or
    $_ -eq 'apps/ai-service/requirements.txt' -or
    $_ -eq 'apps/api/src/migrate.ts'
})
Require ($blocked.Count -eq 0) ("Changes affecting DB migration, active models or protected configuration need manual review: " + ($blocked -join ', '))

Write-Host "Production current: $oldSha"
Write-Host "Production target:  $newSha"
Write-Host "Files changed: $($changed.Count)"
if ($PreflightOnly) {
    Locate-PgDump | Out-Null
    & node (Join-Path $PSScriptRoot 'check-idle.mjs') $ProductionPath
    Require ($LASTEXITCODE -eq 0) 'Production must be idle before deployment.'
    Write-Host 'PASS preflight. No services or tracked files were changed. (Git objects were fetched.)'
    exit 0
}

$backupRoot = Join-Path $hooksPath 'backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $backupRoot $timestamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item -LiteralPath $envPath -Destination (Join-Path $backupDir 'production.env')
$envHash = (Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash
# Preserve installation-specific settings even when an upgrade does not change them.
$localSettings = @('storage/roi_config.json', 'apps/ai-service/models/active/config.json', 'apps/ai-service/models/active/frame_config.json')
foreach ($relative in $localSettings) {
    $source = Join-Path $ProductionPath $relative
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        $destination = Join-Path $backupDir $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }
}
$pgDumpExe = Locate-PgDump

# Database state is backed up but migrations are NOT run by this CI/CD patch.
$dbUrls = @{}
foreach ($key in @('DATABASE_URL', 'AI_DATABASE_URL')) {
    $databaseUrl = Read-DotEnvValue -Name $key -EnvPath $envPath
    Require (-not [string]::IsNullOrWhiteSpace($databaseUrl)) "Missing $key in production .env; backup cannot proceed."
    if (-not $dbUrls.ContainsKey($databaseUrl)) { $dbUrls[$databaseUrl] = "database-$($dbUrls.Count + 1).dump" }
}
foreach ($databaseUrl in @($dbUrls.Keys)) {
    $dumpName = $dbUrls[$databaseUrl]
    Backup-Database -Url $databaseUrl -TargetFile (Join-Path $backupDir $dumpName) -PgDumpExe $pgDumpExe
    Write-Host "PASS database backup: $dumpName"
}
@{ before = $oldSha; after = $newSha; generatedAt = (Get-Date).ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupDir 'revision.json') -Encoding UTF8
Write-Host 'Database backups complete; preparing to restart app services.'

$serviceStateTouched = $false
try {
    & node (Join-Path $PSScriptRoot 'check-idle.mjs') $ProductionPath
    Require ($LASTEXITCODE -eq 0) 'Production must be idle before deployment.'
    $serviceStateTouched = $true
    & $stopHook -ProductionPath $ProductionPath
    Invoke-Git @('checkout', '--detach', $newSha)
    Invoke-Npm @('ci', '--no-audit', '--no-fund')
    & (Join-Path $ProductionPath 'scripts/build-public.ps1')
    & $startHook -ProductionPath $ProductionPath
    Assert-Health
    Require ((Get-FileHash -LiteralPath $envPath -Algorithm SHA256).Hash -eq $envHash) 'Production .env was altered during deployment.'
    foreach ($relative in $localSettings) {
        $saved = Join-Path $backupDir $relative
        if (Test-Path -LiteralPath $saved) {
            Require ((Get-FileHash -LiteralPath $saved).Hash -eq (Get-FileHash -LiteralPath (Join-Path $ProductionPath $relative)).Hash) "Protected setting changed: $relative"
        }
    }
    Write-Host "DEPLOYMENT SUCCESSFUL: $newSha"
}
catch {
    $originalError = $_.Exception.Message
    Write-Warning ('Deployment failed. Attempting code rollback to ' + $oldSha)
    if ($serviceStateTouched) {
        try {
            & $stopHook -ProductionPath $ProductionPath
            Copy-Item -LiteralPath (Join-Path $backupDir 'production.env') -Destination $envPath -Force
            Invoke-Git @('checkout', '--detach', $oldSha)
            foreach ($relative in $localSettings) {
                $saved = Join-Path $backupDir $relative
                if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination (Join-Path $ProductionPath $relative) -Force }
            }
            Invoke-Npm @('ci', '--no-audit', '--no-fund')
            & (Join-Path $ProductionPath 'scripts/build-public.ps1')
            & $startHook -ProductionPath $ProductionPath
            Assert-Health
            Write-Warning 'Application code was rolled back and local API health is OK.'
        }
        catch {
            Write-Error ('ROLLBACK ALSO FAILED. Manual intervention required. Restore revision ' + $oldSha + '. ' + $_.Exception.Message) -ErrorAction Continue
        }
    }
    throw ('Deployment aborted: ' + $originalError + '. Database dumps are stored under .deploy/backups and MUST be protected.')
}
