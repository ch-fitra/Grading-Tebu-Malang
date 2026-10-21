param([switch]$UseSavedToken)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot '.runtime'
$tunnelExecutable = Join-Path $runtime 'cloudflared.exe'
$tokenPath = Join-Path $runtime 'tunnel-token.txt'
if (-not (Test-Path -LiteralPath $tunnelExecutable)) { throw 'cloudflared belum tersedia. Jalankan scripts/setup-public.ps1.' }
$running = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object {
    $_.ExecutablePath -eq $tunnelExecutable -and $_.CommandLine -and $_.CommandLine.Contains($tokenPath)
}
if ($running) { Write-Host 'Connector untuk proyek ini sudah berjalan. Periksa status Healthy di Cloudflare.'; return }
if ($UseSavedToken) {
    if (-not (Test-Path -LiteralPath $tokenPath)) { throw 'Token belum tersedia. Jalankan scripts/connect-tunnel.ps1 tanpa -UseSavedToken terlebih dahulu.' }
} else {
    $secret = Read-Host 'Tempel TOKEN Tunnel dari Cloudflare (input disembunyikan)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $token = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() -split '\s+')[-1]
        if ($token -notmatch '^eyJ[A-Za-z0-9_+/=-]+$') { throw 'Token Tunnel tidak valid.' }
        if (-not (Test-Path -LiteralPath $tokenPath)) { New-Item -ItemType File -Path $tokenPath | Out-Null }
        $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $tokenPath /inheritance:r /grant:r "${account}:(F)" '*S-1-5-18:(F)' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Tidak bisa membatasi akses file token.' }
        [IO.File]::WriteAllText($tokenPath, $token, [Text.Encoding]::ASCII)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $token = $null
    }
}
$tokenArgument = '"' + $tokenPath + '"'
Start-Process -FilePath $tunnelExecutable -ArgumentList 'tunnel','--protocol','http2','--no-autoupdate','run','--token-file',$tokenArgument -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'named-tunnel.log') -RedirectStandardError (Join-Path $runtime 'named-tunnel-error.log') | Out-Null
Write-Host 'Connector dijalankan. Periksa status Healthy di Cloudflare.'
Write-Host 'Arahkan pgtrangkil.aisugarcanembs.com ke service HTTP http://127.0.0.1:8080 pada Tunnel ini.'
Write-Host 'Status domain publik tetap perlu diperiksa melalui browser.'
