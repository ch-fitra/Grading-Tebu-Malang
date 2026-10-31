$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $projectRoot '.runtime/malang'
$manifest = Join-Path $runtime 'processes.json'
if (-not (Test-Path -LiteralPath $manifest)) { Write-Host 'Tidak ada manifest proses Malang.'; return }
$records = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
& node (Join-Path $PSScriptRoot 'assert-malang-idle.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Malang belum idle atau database tidak dapat diperiksa. Tidak ada proses dihentikan.' }
# Validate every identity first: a reused PID must never stop another installation.
foreach ($record in $records) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($record.Id)"
    if (-not $current) { continue }
    if ($current.ExecutablePath -ne $record.Executable -or $current.CommandLine -ne $record.Command -or $current.CreationDate.ToUniversalTime().ToString('o') -ne $record.Created -or $current.CommandLine.Replace('/','\').IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw "Identitas PID $($record.Id) berbeda. Tidak ada proses dihentikan." }
}
foreach ($kind in @('gateway','ai','ai-launcher','api')) {
    foreach ($record in $records | Where-Object Kind -eq $kind) {
        if (-not (Get-Process -Id $record.Id -ErrorAction SilentlyContinue)) { continue }
        if ($kind -eq 'gateway') {
            & $record.Executable -p ($runtime.Replace('\','/') + '/') -c conf/nginx.conf -s quit
            if ($LASTEXITCODE -ne 0) { throw 'Gateway Malang tidak dapat dihentikan secara graceful.' }
        } else { Stop-Process -Id $record.Id -ErrorAction Stop }
    }
}
Remove-Item -LiteralPath $manifest
Write-Host 'Proses Malang dihentikan; proses Trangkil tidak disentuh.'
