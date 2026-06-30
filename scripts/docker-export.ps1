param(
  [string]$ImageName = "invoice-assistant:latest",
  [string]$OutputDir = "D:\DockerImages\invoice-assistant",
  [string]$OutputName = "invoice-assistant-latest.tar"
)

$ErrorActionPreference = "Stop"

& docker image inspect $ImageName *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker image $ImageName does not exist. Build it first."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$TarPath = Join-Path $OutputDir $OutputName

& docker save -o $TarPath $ImageName
if ($LASTEXITCODE -ne 0) {
  throw "docker save failed with exit code $LASTEXITCODE."
}

$Hash = Get-FileHash -Algorithm SHA256 $TarPath
$HashLine = "$($Hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $TarPath)"
$ShaPath = "$TarPath.sha256"
Set-Content -Path $ShaPath -Value $HashLine -Encoding ASCII

Write-Host "Exported $ImageName to $TarPath."
Write-Host "SHA256 written to $ShaPath."
