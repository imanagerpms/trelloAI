# Deploy Scaleway — ship in tempo reale

Vedi [CREATE-INSTANCE.md](./CREATE-INSTANCE.md) per creare la VM.

Comandi quotidiani (dal PC, root del repo):

| Comando | Cosa fa |
|---------|---------|
| `npm run ship:bootstrap` | Installa Node/Caddy/pm2 sul server (una tantum) |
| `npm run ship` | Sync codice + restart bot |
| `npm run ship:env` | Copia `.env` locale sul server |
| `npm run ship:watch` | Sync a ogni salvataggio |

Config locale (gitignored): `deploy/ship.local.json` con `{ "host": "IP" }`.
