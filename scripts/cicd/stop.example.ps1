param([Parameter(Mandatory = $true)][string] $ProductionPath)
# Copy to <ProductionPath>\.deploy\stop.ps1 only AFTER adapting it to your real service manager.
# Must drain ongoing inspections and stop only PG Trangkil API and AI processes.
# Do not stop PostgreSQL, Nginx, Cloudflare Tunnel, GitHub Runner or unrelated apps.
throw 'TODO: Configure a tested stop hook for the actual Trangkil production service manager.'
