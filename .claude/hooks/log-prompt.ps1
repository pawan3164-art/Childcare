$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()

try {
    $data = $raw | ConvertFrom-Json
} catch {
    exit 0
}

$prompt = $data.prompt
if ([string]::IsNullOrEmpty($prompt)) {
    exit 0
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$logFile = Join-Path $repoRoot "All_Prompts.md"

if (-not (Test-Path $logFile)) {
    "# Prompt Log`n" | Out-File -FilePath $logFile -Encoding utf8
}

$timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss"
$entry = "`n## [$timestamp]`n`n$prompt`n`n---`n"

Add-Content -Path $logFile -Value $entry -Encoding utf8
