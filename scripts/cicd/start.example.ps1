param([Parameter(Mandatory = $true)][string] $ProductionPath)
# Copy to <ProductionPath>\.deploy\start.ps1 only AFTER adapting it.
# Start only PG Trangkil API and AI processes, detaching any long-lived jobs.
# Candidate existing script: scripts/resume-public.ps1 (verify its contents and behavior first).
# Must return once the application has started; must NOT keep this shell occupied forever.
throw 'TODO: Configure a tested start hook for the actual Trangkil production service manager.'
