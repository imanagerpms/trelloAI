---
name: trello
description: >-
  Gestisce board e task Trello tramite MCP. Usa quando l'utente chiede di
  vedere, organizzare, spostare, creare o aggiornare task su Trello, o quando
  vuole un riepilogo dello stato della board secondo RULES.md, o quando chiede di
  schedulare compiti per moduli liberi (camere/corridoi/cucine) sulla board Manutenzioni.
---

# Gestione Trello con AI

## Prerequisiti

1. Server MCP `trello` attivo (`.cursor/mcp.json`)
2. Credenziali in `.env` (`TRELLO_API_KEY`, `TRELLO_TOKEN`)
3. Regole personalizzate in `RULES.md` (root progetto)

## Prompt MCP disponibili

Usa i prompt del server MCP quando appropriato:

| Prompt | Quando usarlo |
|--------|---------------|
| `gestisci-trello` | Gestione attiva: l'AI legge RULES.md e applica le regole |
| `stato-trello` | Solo lettura: riepilogo stato board e attività recente |
| `schedula-moduli` | Schedula task per moduli liberi (vedi SCHEDULAZIONE-MODULI.md) |
| `schedula-gestione` | Schedula task di Daniele su Gestione & Amministrazione (vedi RULES-GESTIONE-ADMIN.md) |

## Schedulazione moduli (Manutenzioni)

Quando l'utente dice **"schedula i compiti per i moduli liberi"** + lista sigle + **data scadenza**:

1. Leggi `SCHEDULAZIONE-MODULI.md`
2. Esegui `npm run schedula -- <sigle> --scadenza <data>` oppure applica la regola unica
3. Report in italiano

**Regola unica:** modulo libero → IN ESECUZIONE | non libero + periodico → Periodici | non libero + altro → Settimana

**Scadenze:** spostato in IN ESECUZIONE → scadenza indicata dall'utente | esce da IN ESECUZIONE → scadenza rimossa

**Mai toccare:** Template, Terminati

## Schedulazione Gestione & Amministrazione

Quando l'utente chiede di **schedulare i propri task** su Gestione o Amministrazione:

1. Leggi `RULES-GESTIONE-ADMIN.md`
2. Filtra card assegnate a `TRELLO_DANIELE_ID`, escludi Terminati/DONE/TEMPLATE
3. Rispetta WIP max 3 in corso; proponi schedulazione settimanale prima di modificare
4. Usa board ID da `.env`: `TRELLO_GESTIONE_BOARD_ID`, `TRELLO_AMMINISTRAZIONE_BOARD_ID`

## Tool MCP

| Tool | Scopo |
|------|-------|
| `trello_list_boards` | Elenca le board |
| `trello_get_board_overview` | Panoramica liste + card |
| `trello_list_lists` | Liste di una board |
| `trello_list_cards` | Card per board o lista |
| `trello_get_card` | Dettaglio card (commenti, checklist) |
| `trello_create_card` | Crea task |
| `trello_update_card` | Aggiorna nome, desc, scadenza |
| `trello_move_card` | Sposta tra liste |
| `trello_add_comment` | Commenta una card |
| `trello_archive_card` | Archivia card |
| `trello_search` | Cerca per testo |
| `trello_get_board_activity` | Attività recente |
| `trello_get_labels` | Etichette disponibili |

## Workflow standard

1. **Leggi** `RULES.md` (resource `trello://rules` o file nel progetto)
2. **Ispeziona** con `trello_get_board_overview` o `trello_list_cards`
3. **Riassumi** all'utente: liste, scadenze, blocchi, attività recente
4. **Agisci** secondo RULES.md usando i tool di modifica
5. **Report** finale con modifiche effettuate e prossimi passi

## Regole di sicurezza

- Non archiviare card senza conferma esplicita
- Non spostare più di 5 card senza conferma
- Commenta ogni spostamento non banale
- Se manca `TRELLO_DEFAULT_BOARD_ID`, chiedi quale board usare o elenca con `trello_list_boards`

## Lingua

Rispondi sempre in italiano, salvo diversa richiesta dell'utente.
