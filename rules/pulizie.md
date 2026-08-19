# Pulizie e turni

Regole per **octorate_pulizie** e **octorate_turni**. Pesi e strutture: UI Admin / `config/accommodations.json` + `config/turni.json`.

## Leggenda lista pulizie

Presenta la lista per struttura, in questo ordine:

1. **PARTENZA CON ENTRATA** e **ENTRATA** → `ROOM Np` (es. `ITC#1 2p`). Preparare per N persone, ordine per orario check-in.
2. **PARTENZA SENZA ENTRATA** → `ROOM` (senza numero persone). Stessa pulizia completa di un’entrata, senza preparare per N ospiti. Vale anche per gli appartamenti. Dopo le partenze/entrate con Np.
3. **FERMATA CON CAMBIO** → `ROOM*`. Cambio biancheria bagno/letto, rassetto, terra, cestino, sapone/carta. **Solo affittacamere** — negli appartamenti non si fanno fermate.
4. **FERMATA semplice** e **camere vuote** → in lista; aprire e controllare. Negli appartamenti niente fermate.

Note utili alle cameriere (late/early check-in, letti separati, rose/vino, …) tra `[ ]` dopo la codifica. Ignora testo standard irrilevante.

Se una camera risulta "da assegnare", segnalalo.

## Turni cameriere

Quando chiedono i turni / chi fa cosa:

1. Estrai lo staff dal messaggio: cameriere Roma/centro (default da config), Tenerife (default Lala), assenze, manutentori (Roma + Mario a Tenerife). Domus Turno **non** ha staff dedicato: lo fa una cameriera del pool Roma (passa staff Turno solo se chiesto esplicitamente).
2. Chiama **octorate_turni** (non inventare lo staff Roma se non indicato).
3. Presenta per cameriera: cluster, un blocco per struttura (camere + spazi comuni insieme), +0.3 tragitto se Domus Turno, note `[ ]`, carico.
4. Overflow → **Manutentore** (Roma) / **Mario** (Tenerife).
5. Riporta avvisi (assenze, overflow, cap).

### Regole già applicate dal tool

- Chi pulisce le camere di un affittacamere fa anche gli spazi comuni di quella struttura
- Una struttura compare una sola volta sotto una sola persona
- Spazi comuni **sempre** ogni giorno (anche senza arrivi)
- Domus Turno nel pool Roma, +0.3 carico tragitto, preferita a chi ha già altre strutture
- Tenerife TEN109: pulizie Lala, manutenzioni/overflow Mario
- Overflow oltre cap → manutentore del cluster
