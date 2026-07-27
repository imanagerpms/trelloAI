# TrelloAI

Integrazione Trello + Cursor AI tramite **Model Context Protocol (MCP)**, più bot Telegram **Super Manager** (Octorate, pulizie, turni). Le regole operative vivono in `rules/` e si editano anche dalla UI Admin.

## Setup rapido

### 1. Credenziali Trello

Trello ora richiede un **Power-Up** per generare le chiavi API (la vecchia pagina `trello.com/app-key` reindirizza al nuovo portale).

1. Vai su **[https://trello.com/power-ups/admin](https://trello.com/power-ups/admin)**
2. Clicca **Nuova app** e crea un Power-Up (es. "TrelloAI")
   - Per l'**URL connettore Iframe** puoi usare un placeholder HTTPS qualsiasi (es. `https://example.com`) — **non serve** per l'integrazione MCP, serve solo a Trello per creare l'app
3. Apri il Power-Up → tab **Chiave API** → **Genera una nuova chiave API**
4. Copia la **API Key**
5. Clicca il link **Token** accanto alla chiave → **Consenti** → copia il **Token**

### 2. Configura l'ambiente

```bash
cp .env.example .env
```

Modifica `.env`:

```env
TRELLO_API_KEY=la_tua_api_key
TRELLO_TOKEN=il_tuo_token
TRELLO_DEFAULT_BOARD_ID=id_della_board   # opzionale
```

Per trovare l'ID board: apri la board su Trello, l'URL contiene `/b/SHORTLINK/BOARD_ID` — usa `BOARD_ID`.

### 3. Installa dipendenze

```bash
npm install
```

### 4. Attiva MCP in Cursor

Il file `.cursor/mcp.json` è già configurato. Riavvia Cursor o ricarica la finestra (**Developer: Reload Window**).

Verifica in **Cursor Settings → MCP** che il server `trello` risulti connesso.

## Uso

### Prompt MCP integrati

Nella chat Cursor, puoi invocare i prompt del server:

- **`gestisci-trello`** — l'AI legge `rules/`, analizza la board e gestisce i task
- **`stato-trello`** — solo riepilogo, senza modifiche

### Esempi di richieste

```
Fammi un riepilogo dei task in corso
```

```
Sposta in "Fatto" i task completati in review
```

```
Crea un task "Preparare demo" nel Backlog con scadenza venerdì
```

```
Quali task scadono questa settimana?
```

### Personalizza le regole

Modifica i file in **`rules/`** (o usa la UI Admin) per Manutenzioni, Customer care, Pulizie, Interazione clienti. Config strutture/pesi/board in **`config/`**.

## Tool disponibili

| Tool | Descrizione |
|------|-------------|
| `trello_list_boards` | Elenca le board |
| `trello_get_board_overview` | Panoramica completa |
| `trello_list_cards` | Card per board/lista |
| `trello_get_card` | Dettaglio card |
| `trello_create_card` | Crea task |
| `trello_update_card` | Aggiorna card |
| `trello_move_card` | Sposta tra liste |
| `trello_add_comment` | Aggiunge commento |
| `trello_archive_card` | Archivia card |
| `trello_search` | Cerca per testo |
| `trello_get_board_activity` | Attività recente |
| `trello_get_labels` | Etichette board |

## Struttura progetto

```
trelloAI/
├── .cursor/
│   ├── mcp.json              # Config MCP per Cursor
│   └── skills/trello/        # Skill agente
├── rules/                    # Policy Super Manager per area
├── config/                   # Strutture, pesi turni, board
├── src/
│   ├── server.js             # Server MCP
│   ├── telegram-bot.js       # Bot + HTTP admin
│   └── …
├── .env.example
└── README.md
```

## Uso da cellulare (Telegram su Scaleway)

Il bot `@manager_888_bot` (Super Manager) gira su Scaleway. In **gruppo** rispondi solo se taggato `@manager_888_bot` (il nome visualizzato non basta) oppure in reply a un suo messaggio. In privato risponde sempre.

Programmi in locale; sync immediato senza GitHub.

```powershell
npm run ship:watch
```

Poi testi su Telegram. Commit/push su GitHub solo quando la versione è ok.

**Server attuale:** `151.115.166.171` (Milano) → https://151-115-166-171.sslip.io  
Dettagli: [deploy/README.md](deploy/README.md)

### UI Admin (config Super Manager)

1. Imposta `ADMIN_TOKEN=...` nel `.env` del server (`npm run ship:env`)
2. Apri https://151-115-166-171.sslip.io/admin/
3. Modifica regole markdown per area, strutture Octorate, pesi turni, board Trello
4. I secret (API key) restano solo in `.env` — la UI mostra solo lo stato

Aree: Manutenzioni · Customer care · Pulizie · Interazione clienti (stub AIBridge).

### OAuth Octorate (una tantum)

1. In Octorate → Settings → Advanced → API aggiungi il redirect:
   `https://151-115-166-171.sslip.io/oauth/callback`
2. Apri https://151-115-166-171.sslip.io/oauth/login e autorizza

## Troubleshooting

- **Server MCP non connesso**: verifica che `npm install` sia stato eseguito e che `.env` esista
- **401 Unauthorized**: controlla API key e token
- **Board non trovata**: verifica `TRELLO_DEFAULT_BOARD_ID` o passa l'ID esplicitamente
- **Octorate No identity**: apri `/oauth/login` sul server dopo aver autorizzato il redirect in Octorate
