param(
  [string]$ImageName = "invoice-assistant:latest"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

& docker build -t $ImageName -f (Join-Path $ProjectRoot "Dockerfile") $ProjectRoot
if ($LASTEXITCODE -ne 0) {
  throw "docker build failed with exit code $LASTEXITCODE."
}

Write-Host "Built image $ImageName."
