param(
  [string]$ImageName = "invoice-assistant:latest",
  [string]$ContainerName = "invoice-assistant-offline-smoke"
)

$ErrorActionPreference = "Stop"

function Invoke-DockerChecked {
  param(
    [string[]]$Arguments
  )

  $Output = & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
  return $Output
}

function Remove-SmokeContainer {
  $existing = docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
  if ($existing) {
    docker rm -f $ContainerName | Out-Null
  }
}

try {
  Invoke-DockerChecked @("image", "inspect", $ImageName) | Out-Null
  Remove-SmokeContainer

  Invoke-DockerChecked @("run", "--pull", "never", "-d", "--name", $ContainerName, "--network", "none", $ImageName) | Out-Null

  $healthy = $false
  for ($i = 0; $i -lt 20; $i += 1) {
    Start-Sleep -Seconds 1
    $health = docker exec $ContainerName wget -qO- http://127.0.0.1:8080/healthz 2>$null
    $healthText = ($health -join "`n").Trim()
    if ($LASTEXITCODE -eq 0 -and $healthText -eq "ok") {
      $healthy = $true
      break
    }
  }

  if (-not $healthy) {
    throw "Container did not serve /healthz while running with --network none."
  }

  $index = docker exec $ContainerName wget -qO- http://127.0.0.1:8080/ 2>$null
  $indexText = $index -join "`n"
  if ($LASTEXITCODE -ne 0 -or $indexText -notmatch '<div id="app"></div>') {
    throw "Container did not serve the built Vue app index page."
  }

  Write-Host "Offline smoke passed for $ImageName."
} finally {
  Remove-SmokeContainer
}
