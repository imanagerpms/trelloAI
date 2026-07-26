# Crea l'istanza Scaleway (prima volta)

## 1. Chiave SSH (già sul tuo PC)

Aggiungila in Scaleway Console → **SSH Keys** se non c’è:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPgu/+fBFXQU9QNSoEyLGhF2tFDhCVnqCrM1YiQdlybN login
```

## 2a. Console (consigliato la prima volta)

1. Apri https://console.scaleway.com → **Instances** → **Create instance**
2. Zone: **fr-par-1**
3. Image: **Ubuntu 24.04**
4. Type: **DEV1-S**
5. Public IP: **sì**
6. SSH key: seleziona la chiave sopra
7. Security group: apri **22**, **80**, **443**
8. Create → copia l’**IP pubblico**

## 2b. CLI (alternativa)

```powershell
# login una tantum (apre il browser)
& "$env:USERPROFILE\.local\bin\scw.exe" login

# crea istanza
& "$env:USERPROFILE\.local\bin\scw.exe" instance server create `
  zone=fr-par-1 type=DEV1-S image=ubuntu_noble `
  name=trelloai ip=new `
  --wait
```

Poi:

```powershell
& "$env:USERPROFILE\.local\bin\scw.exe" instance server list zone=fr-par-1
```

## 3. Collega il progetto all’IP

Crea `deploy/ship.local.json`:

```json
{
  "host": "TUO_IP_QUI",
  "user": "root",
  "remotePath": "/opt/trelloai"
}
```

## 4. Bootstrap + primo ship

```powershell
ssh root@TUO_IP
# esci subito dopo il test, poi:

npm run ship:bootstrap
npm run ship
npm run ship:env
```

Apri nel browser: `https://TUO-IP-con-trattini.sslip.io/oauth/login`

In Octorate → Settings → Advanced → API aggiungi il redirect:

`https://TUO-IP-con-trattini.sslip.io/oauth/callback`

## 5. Velocità supersonica

```powershell
npm run ship:watch
```

Modifichi in Cursor → sync automatico → `pm2 restart` sul server.
