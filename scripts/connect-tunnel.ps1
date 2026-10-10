$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot '.runtime'
$tunnelExecutable = Join-Path $runtime 'cloudflared.exe'
$tokenPath = Join-Path $runtime 'tunnel-token.txt'
if (-not (Test-Path $tunnelExecutable)) { throw 'cloudflared belum tersedia.' }
$secret = Read-Host 'Tempel TOKEN Tunnel dari Cloudflare (input disembunyikan)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $token = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() -split '\s+')[-1]
    if ($token -notmatch '^eyJ[A-Za-z0-9_+/=-]+$') { throw 'Token Tunnel tidak valid.' }
    [IO.File]::WriteAllText($tokenPath, $token, [Text.Encoding]::ASCII)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $token = $null
}
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $tokenPath /inheritance:r /grant:r "${account}:(F)" '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Tidak bisa membatasi akses file token.' }
Start-Process -FilePath $tunnelExecutable -ArgumentList 'tunnel','--protocol','http2','--no-autoupdate','run','--token-file',$tokenPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'named-tunnel.log') -RedirectStandardError (Join-Path $runtime 'named-tunnel-error.log')
Write-Host 'Connector dijalankan. Periksa status Healthy di Cloudflare.'
Write-Host 'Arahkan kedua hostname publik ke http://127.0.0.1:8080.'
