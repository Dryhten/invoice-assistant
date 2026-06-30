param(
  [string]$ImageName = "invoice-assistant:latest",
  [string]$ContainerName = "invoice-assistant",
  [int]$HostPort = 0
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Get-DotEnvValue {
  param([string]$Name)

  $EnvPath = Join-Path $ProjectRoot ".env"
  if (-not (Test-Path $EnvPath)) {
    return $null
  }

  foreach ($Line in Get-Content $EnvPath) {
    $Trimmed = $Line.Trim()
    if (-not $Trimmed -or $Trimmed.StartsWith("#")) {
      continue
    }

    $Parts = $Trimmed -split "=", 2
    if ($Parts.Count -eq 2 -and $Parts[0].Trim() -eq $Name) {
      return $Parts[1].Trim().Trim('"').Trim("'")
    }
  }

  return $null
}

if ($HostPort -eq 0) {
  $DockerPortText = Get-DotEnvValue "DOCKER_WEB_PORT"
  $DockerPort = 0
  if ($DockerPortText -and [int]::TryParse($DockerPortText, [ref]$DockerPort)) {
    $HostPort = $DockerPort
  } else {
    $HostPort = 18080
  }
}

if ($HostPort -lt 1 -or $HostPort -gt 65535) {
  throw "HostPort must be between 1 and 65535."
}

$WebPortText = Get-DotEnvValue "WEB_PORT"
$WebPort = 0
if ($WebPortText -and [int]::TryParse($WebPortText, [ref]$WebPort) -and $HostPort -eq $WebPort) {
  throw "Docker host port $HostPort must not reuse WEB_PORT from .env. Set DOCKER_WEB_PORT to a different value."
}

& docker image inspect $ImageName *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker image $ImageName does not exist. Build it first."
}

$Existing = docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
if ($Existing) {
  & docker rm -f $ContainerName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to remove existing container $ContainerName."
  }
}

& docker run --pull never -d --name $ContainerName -p "${HostPort}:8080" $ImageName | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "docker run failed with exit code $LASTEXITCODE."
}

Write-Host "Started $ContainerName from $ImageName."
Write-Host "Open http://127.0.0.1:$HostPort"
Write-Host "Stop with: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-stop.ps1 -ContainerName $ContainerName"
