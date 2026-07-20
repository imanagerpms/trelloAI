# Schedulazione moduli — Manutenzioni

## Comando rapido

Scrivi in chat:

> **Schedula i compiti per i moduli liberi:** NR1, NR2, NR3, NR CORRIDOIO, NR CUCINA — **scadenza 16/07/2026**

Oppure esegui lo script:

```bash
npm run schedula -- NR1 NR2 NR3 "NR CORRIDOIO" "NR CUCINA" --scadenza 16/07/2026
```

Formati data accettati: `16/07/2026`, `2026-07-16`, `domani`

Anteprima senza modifiche:

```bash
npm run schedula -- NR1 NR2 --scadenza 16/07/2026 --dry-run
```

---

## Cos'è un modulo

Un **modulo** è una camera, un corridoio, una cucina o un'area comune, identificato da una **sigla** nel titolo del task:

| Tipo | Esempi sigla |
|------|----------------|
| Camera | `NR1`, `NR2`, `DT101`, `ITC305` |
| Corridoio | `NR CORRIDOIO`, `DF CORRIDOIO` |
| Cucina | `NR CUCINA`, `DC CUCINA` |
| Area comune | `DT AREA COMUNE` |

---

## Regola unica (semplificata)

Le 4 regole originali si riducono a una sola per ogni task:

| Modulo nella lista liberi? | Etichetta "Task Periodico"? | Lista destinazione |
|---------------------------|----------------------------|-------------------|
| ✅ Sì | qualsiasi | **IN ESECUZIONE** |
| ❌ No | ✅ Sì | **Periodici** |
| ❌ No | ❌ No | **Settimana** |

**Liste gestite:** Periodici, IN ESECUZIONE, Cose Da fare, Settimana  
**Liste mai toccate:** Template, Terminati (+ Gestione, Magazzino, Spazio)

Quando un task va in **IN ESECUZIONE**:
- Assegnato a **Costache Ciurar**
- Scadenza impostata alla **data indicata dall'utente**

Quando un task esce da **IN ESECUZIONE** (→ Periodici o Settimana):
- Scadenza **rimossa**

---

## Prompt per l'AI

Quando l'utente dice *"schedula i compiti per i moduli liberi"* seguito dalle sigle:

1. Leggi le sigle moduli fornite (es. `NR1, NR2, NR CORRIDOIO`)
2. Esegui `npm run schedula -- <sigle>` oppure applica la regola unica con i tool Trello
3. Non toccare Template e Terminati
4. Riporta: task spostati, da→a, moduli liberi, eventuali task saltati

---

## Board

- **Manutenzioni** (`618e372daa42cb68df7d7485`)
- Override in `.env`: `TRELLO_MANUTENZIONI_BOARD_ID`
- Manutentore default: `TRELLO_MANUTENTORE_ID` (default: Costache Ciurar)
