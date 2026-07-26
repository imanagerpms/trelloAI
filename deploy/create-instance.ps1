# Crea istanza Scaleway trelloai (richiede scw login già fatto)
$ErrorActionPreference = "Stop"
$scw = Join-Path $env:USERPROFILE ".local\bin\scw.exe"
if (-not (Test-Path $scw)) { throw "scw.exe non trovato in ~/.local/bin — installa la CLI" }

Write-Host "Creo instance DEV1-S ubuntu_noble in fr-par-1…"
& $scw instance server create `
  zone=fr-par-1 `
  type=DEV1-S `
  image=ubuntu_noble `
  name=trelloai `
  ip=new `
  --wait

Write-Host "`nIstanze:"
& $scw instance server list zone=fr-par-1

Write-Host "`nCopia l'IP pubblico e crea deploy/ship.local.json:"
Write-Host '{ "host": "IP", "user": "root", "remotePath": "/opt/trelloai" }'
