# TrelloAI

Integrazione Trello + Cursor AI tramite **Model Context Protocol (MCP)**. L'AI può leggere la board, capire lo stato dei task e gestirli secondo regole che definisci tu in `RULES.md`.

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

- **`gestisci-trello`** — l'AI legge `RULES.md`, analizza la board e gestisce i task
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

Modifica **`RULES.md`** con le tue convenzioni: nomi liste, limiti WIP, priorità, etichette, quando chiedere conferma. L'AI le applica automaticamente.

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
├── src/
│   ├── server.js             # Server MCP
│   └── trello-client.js      # Client API Trello
├── RULES.md                  # Le tue regole (modificabile)
├── .env.example
└── README.md
```

## Uso da cellulare (Cursor Cloud)

Gli agenti girano nel cloud Cursor; da telefono li avvii e li dirigi senza tenere il PC acceso.

### Prerequisiti

1. Piano Cursor con **Cloud Agents** (Pro / Pro+ / Ultra / Teams)
2. Repo su GitHub già collegato a Cursor: `imanagerpms/trelloAI`
3. Push su `main` di skill, `RULES*.md`, `GESTIONE-MANUTENZIONI.md`, `.cursor/mcp.json`, `.cursor/environment.json`

### Secrets (una tantum)

In [Cursor Dashboard → Cloud Agents → Secrets](https://cursor.com/dashboard?tab=cloud-agents) aggiungi le variabili di `.env.example`, almeno:

- `TRELLO_API_KEY`
- `TRELLO_TOKEN`
- `TRELLO_DEFAULT_BOARD_ID` (e gli altri ID board/membri che usi)

Tipo consigliato: **Runtime Secret** per key/token.

### MCP in cloud

Il file `.cursor/mcp.json` è nel repo. Se i tool `trello_*` non compaiono sul cloud agent, aggiungi lo stesso server stdio anche da [Integrations & MCP](https://cursor.com/dashboard) (Team) o dalla UI Cloud Agents:

- command: `node`
- args: `src/server.js` (cwd = root repo)

Le env devono arrivare dai Secrets (il server legge `process.env`; in locale carica anche `.env`).

### Da iPhone

1. Installa **Cursor for iOS** (App Store / beta)
2. Accedi con lo stesso account
3. Scegli il repo `trelloAI` → avvia un **Cloud Agent**
4. Esempi: *«Stato board Manutenzioni»*, *«Schedula i moduli liberi NR1, NR2 con scadenza domani»*

### Da Android (o senza app)

Apri [cursor.com/agents](https://cursor.com/agents) nel browser, stesso flusso Cloud Agent sul repo.

### Remote Control (PC acceso)

Se l’agente deve usare solo l’ambiente locale (MCP già configurato sul desktop): Cursor ≥ 3.9.8 → Settings → Agents → Remote Control, oppure `/remote-control` in chat; poi continua dall’app/browser. Il PC deve restare online.

## Troubleshooting

- **Server MCP non connesso**: verifica che `npm install` sia stato eseguito e che `.env` esista (locale) oppure che i Secrets siano impostati (cloud)
- **401 Unauthorized**: controlla API key e token
- **Board non trovata**: verifica `TRELLO_DEFAULT_BOARD_ID` o passa l'ID esplicitamente
- **Cloud senza tool Trello**: controlla Secrets + MCP dashboard; conferma che `npm install` sia ok nell’environment
