# Claude Overlay (non ufficiale)

Un pop-up flottante e semitrasparente per Windows: lo richiami con una scorciatoia, chiedi qualcosa a Claude (anche a voce) e la risposta compare nello stesso punto dello schermo, senza lasciare quello che stai facendo. Lo stesso pop-up cerca e mostra le note del tuo vault di Obsidian.

È un progetto personale, non un prodotto Anthropic. Di default usa il **tuo abbonamento Claude** (Pro o Max) passando da Claude Code, quindi non paghi niente in più. In alternativa puoi usare una chiave API, che però si paga a consumo.

## Cosa fa

**Chat con Claude** (`Ctrl+Shift+Spazio`)
- Compare nell'angolo che scegli (di default in basso a destra) come una barra compatta e semitrasparente.
- **Spostalo** trascinandolo dalla barra in alto (dove ci sono «Claude» e «Note»): la posizione viene ricordata anche dopo averlo chiuso o riavviato il PC. Si allarga sempre verso il centro dello schermo. **Doppio clic** sulla barra per rimetterlo nell'angolo scelto nelle impostazioni.
- Scrivi e premi Invio: la risposta arriva in streaming in un'anteprima leggermente espansa, nello stesso angolo.
- Clicca sulla risposta (o su ⤢) per espanderla: diventa più grande e scorrevole, con tutta la conversazione.
- Dopo la risposta il pop-up resta visibile per qualche secondo (barra arancione sotto l'intestazione) e poi sparisce. Se ci passi sopra con il mouse il conto alla rovescia si ferma.
- **Puntina** 📌: lo tiene fisso finché vuoi. Quando togli la puntina, il pop-up si chiude.
- **Si apre già fissato** (impostazione «Apri la chat già fissata», attiva di default): fai la domanda e torni al tuo programma con un clic, senza Alt+Tab, mentre il pop-up resta visibile. Si chiude con ✕, `Esc` o ripremendo la scorciatoia; per scrivere di nuovo clicca nel campo o ripremi `Ctrl+Shift+Spazio`.
- **Dettatura** 🎤: il pulsante microfono avvia la digitazione vocale di Windows (`Win+H`) dentro il campo di testo.
- **Immagini**: incollale (`Ctrl+V`) o trascinale nel pop-up; Claude le vede e, se archivi, finiscono in `Images/`.
- **Le tue note come contesto**: a ogni domanda l'overlay cerca nel vault le 3 note più pertinenti e le passa a Claude, che resta coerente con quello che hai scritto (e ti dice se una nota è sbagliata o incompleta). Sotto la risposta vedi «📚 Dalle tue note: …».

**Archiviazione automatica nel vault**
- Dopo ogni risposta un modello veloce (Haiku) decide se e dove archiviarla: materia → categoria → nota, leggendo la struttura del vault dal disco.
- Argomento nuovo → nota nuova in `6 - Atomic Notes/{Materia}/{NN} {Categoria}/` con il formato delle tue note (data, Status, Tags, titolo, References) e link nell'indice `4 - Indexes/{Materia} - {Categoria}.md`.
- Argomento già presente → la nota esistente viene **unita** (dal modello principale), con backup prima e controlli dopo: se qualcosa non torna, il nuovo testo va in fondo sotto `## Aggiunta {data}` invece di sovrascrivere.
- Se serve, crea da sola una categoria (`05 Basi e interfaccia`, indice e riga nella nota tag) o una materia nuova (aggiornando anche «Come usare questo vault»).
- Chiacchiere e ringraziamenti non vengono archiviati. Se è incerto (confidenza sotto 0,6) o qualcosa va storto, l'appunto finisce in `1 - Rough Notes/{data}.md` sotto `## Da sistemare`: non si perde mai niente.
- Script lunghi (oltre ~40 righe) → file in `2 - Source Material/` e nota `Script - …` in `Maya/09 Script Python`.
- Sotto la risposta: `📁 ZBrush › Sculpting › CurveTube… (creata)`. Clicca per aprire la nota nel pop-up, **↩ Annulla** per rimettere il vault com'era.
- Ogni giorno, in `1 - Rough Notes/{data}.md` sotto `## Archiviato oggi`, trovi il registro di cosa è stato creato o aggiornato.
- `/nota testo` passa dallo stesso flusso senza risposta in chat: «Salvato in ZBrush → Sculpting → …».
- Con «Archivia in automatico» spento resta il pulsante **Salva in Obsidian** sotto ogni risposta.

**Note di Obsidian** (`Ctrl+Shift+O`)
- Mostra subito le note modificate di recente; scrivi per cercare per titolo e contenuto (↑/↓ per scegliere, Invio per aprire).
- La nota aperta compare nel pop-up per qualche secondo (15 di default), poi sparisce. Con la puntina 📌 resta fissa.
- I `[[wikilink]]` si aprono nel pop-up, le immagini `![[...]]` si vedono; ↗ apre la nota in Obsidian.
- **Modalità fantasma** 👻 (pulsante nella nota, nella barra, o `Ctrl+Shift+G`): la nota resta sopra le altre finestre, trasparente (60%), con bordo tratteggiato e 👻 nell'angolo, e i clic passano alla finestra sotto. Non sparisce dopo i 15 secondi.
  - **Tieni premuto `Ctrl`** sopra la nota: torna cliccabile finché tieni premuto (per scorrere con la rotellina o cliccare un link), poi torna fantasma.
  - Per uscire: `Ctrl+Shift+G`, oppure passa sul pulsante 👻 e cliccalo.
  - Non è attiva di default; se la vuoi sempre: ⚙ → «Apri le note direttamente in modalità fantasma».
- **Chiedi** allega la nota alla prossima domanda a Claude (es. «riassumila», «fammi 5 domande di ripasso»).

Funziona leggendo direttamente la cartella del vault: non serve installare plugin in Obsidian.

## Installazione

Servono Windows 10/11, [Node.js](https://nodejs.org) 20 o successivo e **Claude Code** collegato al tuo account.

**1. Installa Claude Code e fai l'accesso** (una volta sola). In PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Poi apri un nuovo terminale, esegui `claude` e scegli l'accesso con il tuo account Claude (Pro o Max). Quando vedi il prompt di Claude Code puoi chiuderlo con `/exit`.

**2. Avvia l'overlay:** apri la cartella `claude-overlay` e fai doppio clic su **`Avvia.cmd`**. La prima volta scarica i componenti (qualche minuto), poi parte in pochi secondi.

In alternativa, da un terminale aperto nella cartella `claude-overlay`:

```bash
npm install
npm start
```

Al primo avvio si aprono le impostazioni: controlla che compaia «✓ Claude Code trovato» e scegli la cartella del vault di Obsidian. Da quel momento l'app vive nell'area di notifica (icona a fumetto vicino all'orologio).

Per creare un eseguibile da usare senza Node:

```bash
npm run dist
```

Trovi l'installer e la versione portable nella cartella `dist/`.

### Costi

- **Abbonamento (predefinito):** ogni domanda passa da Claude Code e conta nei limiti di utilizzo del tuo piano, insieme a quello che fai su claude.ai e in Claude Code. Nessun addebito extra. Se raggiungi il limite, l'overlay te lo dice e indica quando si azzera.
- **Chiave API (facoltativa):** le richieste vengono addebitate sul tuo account API, separatamente dall'abbonamento. Si sceglie in ⚙ → Collegamento.

Per sicurezza, in modalità abbonamento l'overlay toglie `ANTHROPIC_API_KEY` dall'ambiente di Claude Code, così non può finire a consumo per sbaglio.

## Impostazioni

Dall'icona ⚙ nel pop-up, oppure dal menu dell'icona nell'area di notifica:

| Impostazione | Default | Note |
|---|---|---|
| Posizione | In basso a destra | Anche in alto, e a sinistra. Si cambia al volo dal menu dell'icona. Scegliere un angolo annulla la posizione trascinata. |
| Opacità sfondo | 86% | Anteprima dal vivo mentre muovi il cursore. |
| Opacità modalità fantasma | 60% | |
| Apri le note in modalità fantasma | no | |
| Risposta visibile per | 12 s | Dopo la risposta, se non fissata. |
| Nota visibile per | 15 s | Dopo aver aperto una nota, se non fissata. |
| Collegamento | Abbonamento (tramite Claude Code) | Oppure chiave API, a consumo. |
| Percorso di Claude Code | trovato da solo | Da indicare solo se è installato in un posto insolito. |
| Modello | Predefinito del piano | Abbonamento: Opus, Sonnet, Haiku, Fable (se inclusi nel piano). Chiave API: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1. |
| Ragionamento | Rapido (low) | Alzalo per domande difficili: risposte migliori ma più lente e più consumo. |
| Ricerca web | sì | Solo modalità abbonamento: Claude può cercare sul web. Non ha altri strumenti (niente file, niente comandi). |
| Archivia in automatico | sì | Spento: resta il pulsante «Salva in Obsidian». |
| Modello per classificare | Haiku | Veloce ed economico; Sonnet o Opus se vuoi più precisione. |
| Modello per unire le note | lo stesso della chat | |
| Soglia di confidenza | 0,6 | Sotto la soglia l'appunto va in `1 - Rough Notes` sotto «Da sistemare». |
| Giorni di backup | 30 | I backup stanno in `%APPDATA%\ClaudeOverlay\backups\{data}\…`, fuori dal vault. |
| Scorciatoie | `Ctrl+Shift+Spazio`, `Ctrl+Shift+O`, `Ctrl+Shift+G` | Clicca il campo e premi la nuova combinazione. |
| Avvia con Windows | no | |

Le impostazioni stanno in `%APPDATA%\claude-overlay\config.json` (menu dell'icona → *Apri cartella configurazione*). La chiave API è cifrata con le credenziali del tuo utente Windows.

## Tasti utili

| Tasto | Azione |
|---|---|
| `Invio` / `Shift+Invio` | Invia / vai a capo |
| `Esc` | Interrompe la risposta, poi riduce, poi chiude |
| Stessa scorciatoia di apertura | Chiude il pop-up |
| `↑` `↓` (note) | Scorre i risultati |

## Privacy

- Le note vengono lette in locale. A Claude arrivano: le 3 note più pertinenti a ogni domanda (come contesto), la nota su cui premi **Chiedi**, e per l'archiviazione l'elenco dei titoli del vault più qualche estratto delle note simili.
- L'archiviazione non scrive mai dentro `.obsidian`, non cancella e non rinomina note (romperebbe i link). Scrive in modo atomico (file temporaneo e poi rinomina), così Obsidian non legge mai un file a metà, e fa una sola archiviazione alla volta.
- **↩ Annulla** non tocca un file che hai modificato nel frattempo (per esempio in Obsidian); le note nuove annullate vengono spostate nei backup, non cancellate.
- In modalità abbonamento Claude Code salva le conversazioni come fa di solito (in `%USERPROFILE%\.claude\projects`), così dopo un'interruzione la conversazione continua con il contesto di prima. In modalità chiave API la conversazione resta solo in memoria finché non premi **+** o chiudi l'app.
- Claude Code gira in una cartella vuota dell'overlay e senza strumenti per file o comandi: può solo rispondere e, se lo lasci attivo, cercare sul web.

## Limiti noti

- In modalità fantasma, per scorrere o cliccare tieni premuto `Ctrl` sopra la nota (va mosso il mouse per far "sentire" il tasto).
- Ogni archiviazione è una chiamata in più a Claude (Haiku, e il modello principale quando unisce): in modalità abbonamento conta nei limiti del piano. Se preferisci archiviare solo quando vuoi tu, spegni «Archivia in automatico».
- La dettatura usa la digitazione vocale di Windows: deve essere attiva in *Impostazioni → Ora e lingua → Voce*.
- Se un'altra app usa già una delle scorciatoie, l'app te lo segnala: cambiala dalle impostazioni.
- La prima domanda dopo l'apertura può impiegare un paio di secondi in più: l'overlay avvia Claude Code in anticipo quando compare, poi lo tiene pronto e lo chiude dopo 10 minuti di inattività.

## Struttura

```
src/
  main.js          finestra overlay, scorciatoie globali, icona, IPC
  preload.js       ponte sicuro verso l'interfaccia
  claude-code.js   conversazione tramite Claude Code (abbonamento)
  claude.js        conversazione tramite chiave API (SDK ufficiale)
  archive.js       archiviazione nel vault (classifica, scrive, unisce, annulla)
  llm.js           chiamate singole a Claude per classificare e unire
  obsidian.js      ricerca, lettura e scrittura nel vault
  config.js        impostazioni e chiave cifrata
  renderer/        interfaccia (HTML, CSS, JS, Markdown sicuro)
```
