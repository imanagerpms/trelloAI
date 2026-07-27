---
name: trello
description: >-
  Gestisce board e task Trello tramite MCP. Usa quando l'utente chiede di
  vedere, organizzare, spostare, creare o aggiornare task su Trello, o quando
  vuole un riepilogo dello stato della board secondo rules/, o quando gestisce
  manutenzioni / schedula compiti per moduli liberi (camere/corridoi/cucine)
  sulla board Manutenzioni (vedi rules/manutenzioni.md).
---

# Gestione Trello con AI

## Prerequisiti

1. Server MCP `trello` attivo (`.cursor/mcp.json`)
2. Credenziali in `.env` (`TRELLO_API_KEY`, `TRELLO_TOKEN`)
3. Regole in `rules/` (o UI Admin `/admin`)

## Prompt MCP disponibili

| Prompt | Quando usarlo |
|--------|---------------|
| `gestisci-trello` | Gestione attiva: legge le regole Super Manager e applica |
| `stato-trello` | Solo lettura: riepilogo stato board |
| `schedula-moduli` | Schedula task per moduli liberi (`rules/manutenzioni.md`) |
| `schedula-gestione` | Schedula task Daniele su Gestione & Amministrazione (`rules/customer-care.md`) |

## Aree Super Manager

| Area | File |
|------|------|
| Core | `rules/super-manager.md` |
| Manutenzioni | `rules/manutenzioni.md` |
| Customer care | `rules/customer-care.md` |
| Pulizie | `rules/pulizie.md` |
| Interazione clienti | `rules/interazione-clienti.md` |

## Gestione Manutenzioni

Quando l'utente gestisce manutenzioni o dice **"schedula i compiti per i moduli liberi"** + lista sigle + **data scadenza**:

1. Leggi `rules/manutenzioni.md`
2. Esegui `npm run schedula -- <sigle> --scadenza <data>` oppure regola unica
3. Report in italiano

**Regola unica:** modulo libero → IN ESECUZIONE | non libero + periodico → Periodici | non libero + altro → Settimana

**Mai toccare:** Template, Terminati

## Schedulazione Gestione & Amministrazione

1. Leggi `rules/customer-care.md`
2. Filtra card assegnate a `TRELLO_DANIELE_ID`, escludi Terminati/DONE/TEMPLATE
3. Rispetta WIP max 3; proponi schedulazione prima di modificare
4. Report in italiano

## Sicurezza

- Conferma prima di archiviare o spostare > 5 card
- Non esporre token / secret
- Rispondi in italiano salvo diversa richiesta
