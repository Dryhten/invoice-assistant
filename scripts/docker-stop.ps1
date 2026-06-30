param(
  [string]$ContainerName = "invoice-assistant"
)

$ErrorActionPreference = "Stop"

$Existing = docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
if (-not $Existing) {
  Write-Host "No container named $ContainerName."
  exit 0
}

& docker rm -f $ContainerName | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to remove container $ContainerName."
}

Write-Host "Stopped and removed $ContainerName."
