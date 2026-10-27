[CmdletBinding()]
param([string]$ProductionPath='C:\Users\Axioo Pongo\Documents\XOORA\AI-Grading-Sugarcane')
$ErrorActionPreference='Stop'
function Require([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
. (Join-Path $PSScriptRoot 'database-backup.ps1')
$envPath=Join-Path $ProductionPath '.env'
Require (Test-Path -LiteralPath $envPath -PathType Leaf) 'Production .env missing.'
$pgDump=Locate-PgDump
$pgRestore=Join-Path (Split-Path -Parent $pgDump) 'pg_restore.exe'
Require (Test-Path -LiteralPath $pgRestore) 'pg_restore is required to validate backup archives.'
$destination=Join-Path $ProductionPath ('.deploy/backups/manual-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
$databases=@{}
foreach ($key in @('DATABASE_URL','AI_DATABASE_URL')) {
    $url=Read-DotEnvValue $key $envPath
    Require (-not [string]::IsNullOrWhiteSpace($url)) "Missing $key. Backup incomplete."
    if (-not $databases.ContainsKey($url)) { $databases[$url]="database-$($databases.Count+1).dump" }
}
foreach ($url in @($databases.Keys)) {
    $name=$databases[$url]
    $target=Join-Path $destination $name
    Backup-Database $url $target $pgDump
    & $pgRestore --list $target *> $null
    Require ($LASTEXITCODE -eq 0) 'Backup archive cannot be read. Do not proceed.'
    Write-Host "PASS database archive created and readable: $name"
}
foreach ($relative in @('.env','storage/roi_config.json','apps/ai-service/models/active/config.json','apps/ai-service/models/active/frame_config.json')) {
    $source=Join-Path $ProductionPath $relative
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        $target=Join-Path $destination $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
        Require ((Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $target).Hash) "Backup verification failed: $relative"
    }
}
$sha=(& git -C $ProductionPath rev-parse HEAD | Out-String).Trim()
Require ($LASTEXITCODE -eq 0) 'Cannot record server revision.'
@{revision=$sha;createdAt=(Get-Date).ToString('o');archives=@($databases.Values);scope='database-and-settings; excludes model binaries and snapshot files';validation='pg_restore --list; full restore not tested'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'backup.json') -Encoding UTF8
Write-Host "BACKUP COMPLETE: $destination"
Write-Host 'No services restarted. Archive readability checked; full restore test remains required.'
