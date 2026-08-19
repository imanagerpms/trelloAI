# Manutenzioni

Documento di riferimento per la board **Manutenzioni** degli affittacamere.

| Board | ID | Override `.env` |
|-------|-----|-----------------|
| **Manutenzioni** | `618e372daa42cb68df7d7485` | `TRELLO_MANUTENZIONI_BOARD_ID` |

**Manutentore di riferimento:** Costache Ciurar (`TRELLO_MANUTENTORE_ID`)

## Liste

| Lista | Ruolo |
|-------|--------|
| **IN ESECUZIONE** | Lavori attivi sui moduli accessibili (liberi o finestra tra ospiti) |
| **Settimana** | Task non periodici da fare quando il modulo non è accessibile |
| **Periodici** | Task ricorrenti in attesa che il modulo sia accessibile |
| **Cose Da fare** | Backlog manutenzioni |
| **Template** | Modelli — **mai toccare** |
| **Terminati** | Completati — **mai toccare** |
| Gestione, Magazzino, Spazio | Contesto / supporto — **non spostare card qui** |

**Liste gestite dalla schedulazione:** Periodici, IN ESECUZIONE, Cose Da fare, Settimana

## Cos’è un modulo

Un **modulo** è una camera, un corridoio, una cucina o un’area comune, identificato da una **sigla** nel titolo del task:

| Tipo | Esempi sigla |
|------|----------------|
| Camera | `NR1`, `NR2`, `DT101`, `ITC305` |
| Corridoio | `NR CORRIDOIO`, `DF CORRIDOIO` |
| Cucina | `NR CUCINA`, `DC CUCINA` |
| Area comune | `DT AREA COMUNE` |

Un modulo è **accessibile** (può entrare in **IN ESECUZIONE**) quando Octorate lo indica come:

| Stato `octorate_camere` | Significato | Scadenza tipica |
|-------------------------|-------------|-----------------|
| **LIBERA** | `availability>0` tutte le notti del range | data indicata dall’utente (giorno) |
| **FINESTRA** | checkout al mattino + check-in nel pomeriggio lo stesso giorno | orario arrivo nuovo ospite (`arrivalTime`, default 14:00 Europe/Rome) |
| **OCCUPATA** | non disponibile | non schedulare in IN ESECUZIONE |

Fonte: tool **octorate_camere** (`libere[]` + `finestre[]`, con `sigla` Manutenzioni). Non chiedere all’utente l’elenco — verificare sempre su Octorate.

## Schedulazione moduli (regola unica)

Per ogni task sulle liste gestite:

| Modulo accessibile (libero o finestra)? | Etichetta `Task Periodico`? | Lista destinazione |
|-----------------------------------------|----------------------------|-------------------|
| Sì | qualsiasi | **IN ESECUZIONE** |
| No | Sì | **Periodici** |
| No | No | **Settimana** |

### Scadenze e assegnazioni

- Task che **entra** in IN ESECUZIONE → assegnato a Costache Ciurar + scadenza:
  - moduli **LIBERA** → data `--scadenza`
  - moduli **FINESTRA** → stesso giorno all’orario arrivo (`--finestra SIGLA=HH:MM` / `moduleDues`)
- Task già in IN ESECUZIONE con override finestra → aggiorna solo la scadenza se diversa
- Task che **esce** da IN ESECUZIONE (→ Periodici o Settimana) → scadenza **rimossa**

### Comando rapido

In chat:

> **Schedula i compiti per i moduli liberi:** NR1, NR2, NR3, NR CORRIDOIO, NR CUCINA — **scadenza 16/07/2026**  
> (con finestre: NR3 entro le 15:00, ITC301 entro le 14:30)

O via script:

```bash
npm run schedula -- NR1 NR2 NR3 "NR CORRIDOIO" "NR CUCINA" --scadenza 16/07/2026
npm run schedula -- NR1 NR3 ITC301 --scadenza 16/07/2026 --finestra NR3=15:00,ITC301=14:30
```

Anteprima: `npm run schedula -- NR1 NR2 --scadenza 16/07/2026 --dry-run`

Formati data: `16/07/2026`, `2026-07-16`, `domani`

## Priorità operative

1. **Emergenze / urgenze** → subito, anche fuori dalla schedulazione moduli
2. **IN ESECUZIONE** con scadenza oggi / scaduta → verificare e aggiornare
3. **Moduli FINESTRA** (deadline stretta sull’arrivo) → schedulare subito con orario arrivo
4. **Moduli LIBERA** → schedulare subito
5. **Periodici** su moduli che diventano accessibili → promuovere in IN ESECUZIONE
6. **Settimana / Cose Da fare** → pianificare con slot e moduli accessibili

## Comportamento AI

1. Leggere questo file prima di agire sulla board Manutenzioni
2. Se servono i moduli accessibili (per data o “domani”): chiamare **octorate_camere** e riportare **LIBERE** e **FINESTRE** (con orario arrivo) — non chiedere l’elenco all’utente
3. Ispezionare lo stato Trello prima di modificare
4. Schedulazione: tool **schedula_moduli** / `npm run schedula` con sigle = `libere` + `finestre` da Octorate; passare `--finestra` / `moduleDues` per le finestre
5. Non toccare **Template** e **Terminati**
6. Conferma prima di archiviare o spostare più di 5 card (salvo schedulazione esplicita)
7. Commentare ogni spostamento non banale
8. Report finale in italiano
