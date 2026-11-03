'use strict';
// Archiviazione automatica nel vault Obsidian.
// Ogni domanda/risposta viene classificata (materia → categoria → nota) e scritta nella nota
// giusta con lo stesso formato delle note esistenti. Struttura del vault:
//   3 - Tags/{Materia}.md
//   4 - Indexes/{Materia} - {Categoria}.md
//   6 - Atomic Notes/{Materia}/{NN} {Categoria}/{Titolo}.md
//   1 - Rough Notes/{YYYY-MM-DD}.md   (registro del giorno e "Da sistemare")
// Sicurezza: backup fuori dal vault prima di ogni modifica, scrittura atomica,
// una sola archiviazione alla volta, mai cancellare o rinominare note.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DIRS = {
  rough: '1 - Rough Notes',
  source: '2 - Source Material',
  tags: '3 - Tags',
  indexes: '4 - Indexes',
  template: '5 - Template',
  atomic: '6 - Atomic Notes',
  images: 'Images',
};
const GUIDE_NOTE = `${DIRS.indexes}/Come usare questo vault.md`;
const SCRIPT_SUBJECT = 'Maya';
const SCRIPT_CATEGORY = 'Script Python';
const SCRIPT_HOWTO = 'Script - Come lanciare uno script';
const LONG_SCRIPT_LINES = 40;
const MAX_TITLE = 80;
const MAX_PATH = 250;
const MAX_TREE_TITLES = 250; // titoli al massimo nel prompt di classificazione
// Saluti e conferme: non serve chiamare il modello per sapere che non vanno archiviati.
const SMALL_TALK = /^(grazie( mille| tante)?|ok(ay)?|perfetto|ciao|va bene|ottimo|top|capito|thanks|thank you)[\s!.,?]*$/i;

// ------------------------------------------------------------------ prompt

const CLASSIFY_SYSTEM = `Sei l'archivista del vault Obsidian dell'utente. Ricevi uno scambio avvenuto nell'overlay (domanda e risposta di Claude, oppure un appunto scritto dall'utente) e decidi se e dove archiviarlo come nota.

Struttura del vault:
- Materie = cartelle dentro "6 - Atomic Notes" (es. ZBrush, Maya).
- Categorie = sottocartelle "NN Nome" di ogni materia; il nome della categoria è senza numero ("02 Sculpting" → "Sculpting").
- Ogni nota è un file "Titolo.md" dentro la sua categoria.

Azioni, una per ogni argomento distinto:
- "salta": chiacchiere, ringraziamenti, domande non tecniche, o contenuto già presente identico nel vault. Non si scrive niente.
- "unisci": esiste già una nota sullo stesso argomento (stesso comando o stesso problema). Cercala in tutta la materia, non solo nella categoria scelta. In "nota_esistente" metti il suo percorso: "6 - Atomic Notes/{Materia}/{NN Categoria}/{Titolo}.md".
- "nuova": argomento nuovo.
Nell'albero, le categorie lontane dalla domanda mostrano solo il numero di note: per "unisci" usa solo note di cui vedi il titolo (nell'albero o tra le note simili).
Se la risposta tratta argomenti diversi (es. tre comandi diversi), restituisci un oggetto per argomento: una nota per argomento.

Categorie e materie:
- Usa una categoria esistente se va bene. Creane una nuova ("categoria_nuova": true) solo se nessuna categoria esistente della materia è adatta.
- Prima di inventare un nome, guarda le categorie delle altre materie: se esiste lo stesso concetto, usa lo stesso nome identico (es. se Maya ha "Basi e interfaccia", in ZBrush usa "Basi e interfaccia", non "Interfaccia").
- Nomi di categoria brevi, in italiano, nello stile di quelli esistenti (es. "Blocking", "Problem solving", "Retopo ed export"), senza numero.
- Per una categoria nuova scrivi "descrizione_categoria": una frase breve per l'elenco della materia.
- Materia nuova ("materia_nuova": true) solo per un programma o soggetto che non c'è ancora; scrivi "descrizione_materia" (una frase) e la sua prima categoria.

Titolo: in italiano e orientato all'uso: verbo + scopo, con lo strumento tra parentesi per ritrovarlo (es. "Smussare gli spigoli senza deformare la mesh (Bevel)", "Isolare e cancellare il guscio interno dopo Extract"); al massimo 80 caratteri; senza i caratteri \\ / : * ? " < > | # ^ [ ].

Contenuto (campo "contenuto", Markdown). È una guida, non la chat:
- Inizia SEMPRE con il riassunto d'uso, su due righe:
  > [!summary] In breve
  > a cosa serve, in una frase.
- Poi preferisci una tabella a due colonne:
  | Vuoi… | Fai così |
  | --- | --- |
  | Cos'è | … |
  | Attivarlo | … |
  | Quando serve | … |
  | Limite | … |
  | Flusso | 1) … 2) … 3) … |
  | Non funziona | … |
  Usa solo le righe che servono, con nomi adatti all'argomento, ma sempre in quest'ordine: Cos'è → Quando serve → Come si fa (Attivarlo, Flusso) → Scorciatoie → Limite → Non funziona.
- La prima volta che nomini uno strumento o comando del programma (es. Bevel, Extrude, Extract) scrivilo come link: [[Bevel]].
- In alternativa, per elenchi di termini o scorciatoie: "- **Termine** – spiegazione."
- Percorsi dei menu con → (es. Tool → SubTool → Extract). Tasti e nomi di comandi in **grassetto** (es. **Shift+D**).
- Simboli ammessi: 💡 consiglio · ⚠️ attenzione · ✅ regola di qualità.
- Breve e pratico. Niente saluti, niente "come ti dicevo", niente domande finali.
- Italiano; nomi di comandi e menu come appaiono nel programma (in inglese).
- Solo il corpo: niente data, Status, Tags, titolo "# …" o References (li aggiunge il programma).
- Immagini allegate (IMG1, IMG2…): metti il segnaposto {{IMG1}} da solo su una riga, nel punto giusto del contenuto.
- Script lunghi (SCRIPT_1…): non copiare il codice. Crea un oggetto con "tipo": "script", "script": "SCRIPT_1", materia "${SCRIPT_SUBJECT}", categoria "${SCRIPT_CATEGORY}", titolo "Script - {cosa fa}", "nome_script" (nome breve della cartella) e "nome_file" (es. "rinomina_oggetti.py"). Nel contenuto spiega a cosa serve e come lanciarlo con un link a [[${SCRIPT_HOWTO}]], e metti {{SCRIPT_1}} dove va il link al file. Gli script brevi restano nel contenuto in un blocco di codice.

"argomento_breve": 1-4 parole sull'argomento (es. "CurveTube"), per la riga riassuntiva dell'indice.
"scorciatoie": ogni scorciatoia da tastiera citata, come {"tasti": "Ctrl+B", "azione": "cosa fa, breve"}; [] se nessuna.
"strumenti": i nomi degli strumenti o comandi del programma linkati nel contenuto (es. ["Bevel", "Extrude"]); [] se nessuno.
"confidenza": da 0 a 1, quanto sei sicuro di azione, materia e categoria.

Rispondi SOLO con un array JSON, senza testo prima o dopo e senza blocchi di codice. Ogni oggetto:
{"azione": "nuova" | "unisci" | "salta", "tipo": "nota", "materia": "", "categoria": "", "categoria_nuova": false, "materia_nuova": false, "titolo": "", "nota_esistente": "", "descrizione_categoria": "", "descrizione_materia": "", "argomento_breve": "", "confidenza": 0.0, "contenuto": "", "script": "", "nome_script": "", "nome_file": "", "scorciatoie": [], "strumenti": []}`;

const MERGE_SYSTEM = `Unisci un nuovo contenuto a una nota esistente del vault Obsidian dell'utente.
Restituisci SOLO il testo completo della nota unita: niente blocchi di codice intorno, niente commenti.
Regole:
- Mantieni identici l'intestazione (riga vuota iniziale, data originale, "Status:", "Tags: …"), il titolo "# …" e la sezione "# References".
- Integra le informazioni nuove nella riga o sezione giusta (per esempio come riga della tabella esistente).
- Niente duplicati.
- Non togliere informazioni esistenti, a meno che siano contraddette da quelle nuove: in quel caso tieni la nuova.
- Mantieni lo stile della nota: tabelle a due colonne, **grassetto** per tasti e comandi, → per i menu, italiano, simboli 💡 ⚠️ ✅.`;

// ------------------------------------------------------------- utilità

function romeNow(d = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, hms: `${p.hour}${p.minute}${p.second}` };
  } catch {
    const z = (n) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`,
      time: `${z(d.getHours())}:${z(d.getMinutes())}`,
      hms: `${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`,
    };
  }
}

/** Nome di file valido su Windows e sicuro per i [[link]] di Obsidian. */
function sanitizeName(name, max = MAX_TITLE) {
  let s = String(name || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) {
    s = s.slice(0, max);
    const cut = s.lastIndexOf(' ');
    if (cut > max * 0.6) s = s.slice(0, cut);
  }
  s = s.replace(/[.\s-]+$/, '').replace(/^[.\s]+/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `${s} (nota)`;
  return s;
}

function categoryParts(folder) {
  const m = folder.match(/^(\d{2}) (.+)$/);
  return m ? { num: Number(m[1]), name: m[2] } : { num: null, name: folder };
}

const pad2 = (n) => String(n).padStart(2, '0');
const lc = (s) => String(s || '').toLowerCase().trim();
const toPosix = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
const normalizeNewlines = (s) => String(s || '').replace(/\r\n?/g, '\n');

function noteText({ date, tags, title, body, refs }) {
  const bodyPart = body && body.trim() ? `${body.trim()}\n\n` : '';
  const refsPart = refs ? `\n\n${refs}\n` : '\n';
  return `\n${date}\n\nStatus:\n\nTags: ${tags}\n\n# ${title}\n\n${bodyPart}# References${refsPart}`;
}

function lastHeadingIndex(lines, re) {
  for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return i;
  return -1;
}

/** Inserisce righe prima di "# References" (o in fondo), con una riga vuota prima e dopo. */
function insertBeforeReferences(text, blockLines) {
  const lines = text.split('\n');
  let at = lastHeadingIndex(lines, /^# References\s*$/);
  if (at < 0) at = lines.length;
  while (at > 0 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, '', ...blockLines, '');
  return tidy(lines.join('\n'));
}

/** Aggiunge una riga di elenco dopo l'ultima riga che soddisfa `isItem`, prima di "# References". */
function appendListItem(text, line, isItem) {
  const lines = text.split('\n');
  const refs = lastHeadingIndex(lines, /^# References\s*$/);
  const limit = refs < 0 ? lines.length : refs;
  let last = -1;
  for (let i = 0; i < limit; i++) if (isItem(lines[i])) last = i;
  if (last >= 0) {
    lines.splice(last + 1, 0, line);
    return lines.join('\n');
  }
  return insertBeforeReferences(text, [line]);
}

// Niente più di una riga vuota di fila, una sola a fine file.
function tidy(text) {
  return text.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

function updateItalicLine(text, topic) {
  if (!topic) return text;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^\*[^*].*\*$/.test(l.trim()));
  if (i < 0) return text;
  const inner = lines[i].trim().slice(1, -1).replace(/\.\s*$/, '').trim();
  if (lc(inner).includes(lc(topic))) return text;
  lines[i] = inner ? `*${inner}, ${topic}.*` : `*${topic}.*`;
  return lines.join('\n');
}

/** Aggiunge "· [[link]]" dopo l'ultimo link di una riga, rispettando il separatore usato. */
function appendLinkToLine(line, link, knownLinks) {
  let lastEnd = -1;
  for (const l of knownLinks) {
    const idx = line.lastIndexOf(l);
    if (idx >= 0) lastEnd = Math.max(lastEnd, idx + l.length);
  }
  if (lastEnd < 0 && line.includes(']]')) lastEnd = line.lastIndexOf(']]') + 2; // ultimo link della riga
  if (lastEnd < 0) return null;
  const sep = line.includes(']], [[') ? ', ' : ' · ';
  return `${line.slice(0, lastEnd)}${sep}${link}${line.slice(lastEnd)}`;
}

function extractLongScripts(answer) {
  const scripts = [];
  let text = String(answer || '');
  text = text.replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g, (block, lang, code) => {
    const lines = code.replace(/\n$/, '').split('\n').length;
    if (lines <= LONG_SCRIPT_LINES) return block;
    const id = `SCRIPT_${scripts.length + 1}`;
    scripts.push({ id, lang: lang || 'python', code: code.replace(/\n$/, '\n'), lines });
    return `[${id}: script ${lang || ''} di ${lines} righe, vedi <script_lunghi>]`;
  });
  return { text, scripts };
}

function parseItems(raw) {
  let t = normalizeNewlines(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (start < 0 || end < start) throw new Error('La classificazione non ha restituito JSON.');
  let data = JSON.parse(t.slice(start, end + 1));
  if (!Array.isArray(data)) data = [data];
  return data
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      azione: ['nuova', 'unisci', 'salta'].includes(lc(x.azione)) ? lc(x.azione) : 'nuova',
      tipo: lc(x.tipo) === 'script' ? 'script' : 'nota',
      materia: String(x.materia || '').trim(),
      categoria: String(x.categoria || '').trim().replace(/^\d{2}\s+/, ''),
      categoriaNuova: Boolean(x.categoria_nuova),
      materiaNuova: Boolean(x.materia_nuova),
      titolo: String(x.titolo || '').trim(),
      notaEsistente: toPosix(x.nota_esistente || ''),
      descrizioneCategoria: String(x.descrizione_categoria || '').trim().replace(/\.$/, ''),
      descrizioneMateria: String(x.descrizione_materia || '').trim().replace(/\.$/, ''),
      argomento: String(x.argomento_breve || '').trim().replace(/\.$/, ''),
      confidenza: Number.isFinite(Number(x.confidenza)) ? Number(x.confidenza) : 0,
      contenuto: normalizeNewlines(x.contenuto || '').trim(),
      script: String(x.script || '').trim(),
      nomeScript: String(x.nome_script || '').trim(),
      nomeFile: String(x.nome_file || '').trim(),
      scorciatoie: (Array.isArray(x.scorciatoie) ? x.scorciatoie : [])
        .filter((k) => k && k.tasti)
        .map((k) => ({ tasti: String(k.tasti).trim(), azione: String(k.azione || '').trim() })),
      strumenti: (Array.isArray(x.strumenti) ? x.strumenti : []).map((t) => sanitizeName(t, 50)).filter(Boolean),
    }));
}

function stripFences(text) {
  const t = normalizeNewlines(text).trim();
  const m = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return m ? m[1] : t;
}

// -------------------------------------------------------------- archivista

class Archivist {
  /**
   * @param {{ getConfig: () => object, getVault: () => import('./obsidian').Vault, oneShot: import('./llm').OneShot, backupRoot: string }} deps
   */
  constructor({ getConfig, getVault, oneShot, backupRoot }) {
    this.getConfig = getConfig;
    this.getVault = getVault;
    this.oneShot = oneShot;
    this.backupRoot = backupRoot;
    this.queue = Promise.resolve();
    this.ops = new Map(); // id → operazione (per Annulla)
  }

  get root() {
    const v = this.getVault();
    return v && v.root ? v.root : '';
  }

  /** Una sola archiviazione alla volta: le altre aspettano in coda. */
  enqueue(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  archive(job) {
    return this.enqueue(() => this.archiveNow(job));
  }

  undo(opId) {
    return this.enqueue(() => this.undoNow(opId));
  }

  // --------------------------------------------------------------- percorsi

  full(rel, root = this.root) {
    const clean = toPosix(rel);
    if (!clean || clean.split('/').some((p) => p === '..' || p === '.obsidian' || p === '')) {
      throw new Error(`Percorso non consentito: ${rel}`);
    }
    const full = path.resolve(root, ...clean.split('/'));
    if (!full.startsWith(root + path.sep)) throw new Error(`Percorso fuori dal vault: ${rel}`);
    return full;
  }

  async exists(rel) {
    try {
      await fsp.access(this.full(rel));
      return true;
    } catch {
      return false;
    }
  }

  async readText(rel) {
    return normalizeNewlines(await fsp.readFile(this.full(rel), 'utf8'));
  }

  // ------------------------------------------------------------ scrittura

  async atomicWrite(full, data) {
    const dir = path.dirname(full);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.~${path.basename(full)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    await fsp.writeFile(tmp, data);
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(tmp, full);
        return;
      } catch (err) {
        // Obsidian o l'antivirus possono tenere il file per un attimo.
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
          await fsp.unlink(tmp).catch(() => {});
          throw err;
        }
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
  }

  async backup(rel, data) {
    const { date, hms } = romeNow();
    let dest = path.join(this.backupRoot, date, ...toPosix(rel).split('/'));
    const ext = path.extname(dest);
    const stem = dest.slice(0, dest.length - ext.length);
    for (let n = 1; await fsp.access(dest).then(() => true, () => false); n++) {
      dest = `${stem} ~${hms}${n > 1 ? `-${n}` : ''}${ext}`; // più backup dello stesso file nello stesso giorno
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data);
  }

  /** Scrive un file di testo registrando lo stato precedente per Annulla. */
  async writeText(op, rel, text) {
    rel = toPosix(rel);
    const full = this.full(rel);
    let before = null;
    try {
      before = await fsp.readFile(full); // byte originali: Annulla li rimette identici
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // file bloccato: meglio fermarsi che sovrascrivere senza backup
    }
    if (before !== null) await this.backup(rel, before);
    const entry = op.journal.find((e) => e.rel === rel);
    if (entry) entry.after = text;
    else op.journal.push({ rel, before, after: text });
    await this.ensureDir(op, path.dirname(full));
    await this.atomicWrite(full, text);
  }

  async writeBinary(op, rel, buffer) {
    rel = toPosix(rel);
    const full = this.full(rel);
    // Per Annulla basta l'impronta del file scritto: le immagini non restano in memoria.
    op.journal.push({ rel, before: null, afterHash: crypto.createHash('sha1').update(buffer).digest('hex') });
    await this.ensureDir(op, path.dirname(full));
    await this.atomicWrite(full, buffer);
  }

  async ensureDir(op, dir) {
    const missing = [];
    let d = dir;
    while (d.startsWith(this.root + path.sep)) {
      try {
        await fsp.access(d);
        break;
      } catch {
        missing.unshift(d);
        d = path.dirname(d);
      }
    }
    for (const m of missing) {
      await fsp.mkdir(m);
      op.createdDirs.push(m);
    }
  }

  async pruneBackups() {
    const days = this.getConfig().backupDays || 30;
    const limit = Date.now() - days * 24 * 60 * 60 * 1000;
    let entries = [];
    try {
      entries = await fsp.readdir(this.backupRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(e.name)) continue;
      const t = Date.parse(`${e.name}T00:00:00`);
      if (Number.isFinite(t) && t < limit) {
        await fsp.rm(path.join(this.backupRoot, e.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  // ------------------------------------------------------------- lettura

  /** Materie → categorie → titoli, letti dal disco ogni volta. */
  async scanTree() {
    const atomic = path.join(this.root, DIRS.atomic);
    const subjects = [];
    let subjectDirs = [];
    try {
      subjectDirs = await fsp.readdir(atomic, { withFileTypes: true });
    } catch {
      return subjects;
    }
    for (const sd of subjectDirs) {
      if (!sd.isDirectory() || sd.name.startsWith('.')) continue;
      const subject = { name: sd.name, categories: [] };
      const catDirs = await fsp.readdir(path.join(atomic, sd.name), { withFileTypes: true }).catch(() => []);
      for (const cd of catDirs) {
        if (!cd.isDirectory() || cd.name.startsWith('.')) continue;
        const { num, name } = categoryParts(cd.name);
        const notes = await listNotes(path.join(atomic, sd.name, cd.name));
        subject.categories.push({ folder: cd.name, num, name, notes });
      }
      subject.categories.sort((a, b) => (a.num ?? 99) - (b.num ?? 99) || a.name.localeCompare(b.name));
      subjects.push(subject);
    }
    subjects.sort((a, b) => a.name.localeCompare(b.name));
    return subjects;
  }

  // --------------------------------------------------------- archiviazione

  /**
   * @param {{ question?: string, answer: string, previous?: {question: string, answer: string},
   *           images?: {data: string, mediaType: string}[], kind?: 'chat'|'nota' }} job
   */
  async archiveNow(job) {
    if (!this.root) return { ok: false, error: 'Cartella del vault non impostata (⚙ → Vault Obsidian).' };
    const cfg = this.getConfig();
    const now = romeNow();
    const op = { id: crypto.randomUUID(), journal: [], createdDirs: [], undone: false, now, root: this.root };
    const question = String(job.question || '').trim();
    const answer = normalizeNewlines(job.answer || '').trim();
    const images = Array.isArray(job.images) ? job.images : [];
    const result = { ok: true, opId: op.id, items: [], rough: false, skipped: false };
    if (job.kind !== 'nota' && SMALL_TALK.test(question)) {
      result.skipped = true;
      return this.finish(op, result);
    }

    try {
      const tree = await this.scanTree();
      const vault = this.getVault();
      const related = await vault
        .relevant(`${question}\n${answer.slice(0, 1500)}`, 5, [DIRS.rough, DIRS.template, DIRS.source, DIRS.tags, DIRS.indexes])
        .catch(() => []);
      const { text: answerForModel, scripts } = extractLongScripts(answer);

      let items;
      try {
        const raw = await this.oneShot.run({
          system: CLASSIFY_SYSTEM,
          prompt: classifyPrompt({ tree, related, question, answer: answerForModel, previous: job.previous, images, scripts, kind: job.kind }),
          model: cfg.classifyModel || 'haiku',
          effort: 'low',
        });
        items = parseItems(raw);
      } catch (err) {
        // Classificazione fallita (API spenta, limite, JSON non valido): l'appunto non si perde.
        const withImages = await this.withAttachments(op, now, answer, 'Da sistemare', { images: images.map((img, i) => ({ ...img, tag: `{{IMG${i + 1}}}` })), scripts: [] });
        await this.addRough(op, now, question, withImages, `Classificazione non riuscita: ${err.message}`);
        result.rough = true;
        result.reason = err.message;
        return this.finish(op, result);
      }

      const toWrite = items.filter((i) => i.azione !== 'salta');
      if (!toWrite.length) {
        result.skipped = true;
        return this.finish(op, result);
      }

      const placeholders = this.assignAttachments(toWrite, images, scripts);
      const names = await vault.noteNames();
      const log = [];
      for (const item of toWrite) {
        const attachments = placeholders.get(item);
        if (item.confidenza < (cfg.confidenceThreshold ?? 0.6)) {
          const body = await this.withAttachments(op, now, item.contenuto || answer, item.titolo || 'Da sistemare', attachments);
          await this.addRough(op, now, question, body, `Confidenza bassa (${item.confidenza}): proposta ${item.materia} › ${item.categoria} › ${item.titolo}`);
          result.rough = true;
          continue;
        }
        try {
          const done = await this.writeItem(op, now, item, tree, names, attachments, cfg);
          result.items.push(done);
          log.push(...done.log);
          await this.updateHubs(op, now, item, done, log).catch(() => {}); // scorciatoie e strumenti: mai bloccanti
        } catch (err) {
          const body = await this.withAttachments(op, now, item.contenuto || answer, item.titolo || 'Da sistemare', attachments).catch(() => item.contenuto || answer);
          await this.addRough(op, now, question, body, `Scrittura non riuscita: ${err.message}`);
          result.rough = true;
        }
      }
      if (log.length) await this.addLogLines(op, now, log);
      return this.finish(op, result);
    } catch (err) {
      // Ultima rete di sicurezza: domanda e risposta grezze in "Da sistemare".
      try {
        await this.addRough(op, now, question, answer, `Errore: ${err.message}`);
        result.rough = true;
        result.reason = err.message;
        return this.finish(op, result);
      } catch (err2) {
        return { ok: false, error: `Archiviazione non riuscita: ${err2.message}` };
      }
    }
  }

  finish(op, result) {
    if (result.rough) result.roughRel = this.roughRel(op.now || romeNow());
    if (op.journal.length) {
      this.ops.set(op.id, op);
      if (this.ops.size > 20) this.ops.delete(this.ops.keys().next().value);
    } else {
      result.opId = null;
    }
    const v = this.getVault();
    if (v) v.markChanged(op.journal.map((e) => e.rel));
    this.pruneBackups().catch(() => {});
    return result;
  }

  /** Decide a quale nota vanno immagini e script; quelli non piazzati vanno alla prima nota. */
  assignAttachments(items, images, scripts) {
    const map = new Map(items.map((i) => [i, { images: [], scripts: [] }]));
    images.forEach((img, idx) => {
      const tag = `{{IMG${idx + 1}}}`;
      const owner = items.find((i) => i.contenuto.includes(tag)) || items[0];
      map.get(owner).images.push({ ...img, tag });
    });
    for (const s of scripts) {
      const owner = items.find((i) => i.script === s.id || i.contenuto.includes(`{{${s.id}}}`)) || items[0];
      const named = owner.script === s.id;
      map.get(owner).scripts.push({ ...s, nomeScript: named ? owner.nomeScript : '', nomeFile: named ? owner.nomeFile : '' });
    }
    return map;
  }

  async writeItem(op, now, item, tree, names, attachments, cfg) {
    const log = [];
    if (item.tipo === 'script') {
      item.materia = SCRIPT_SUBJECT;
      item.categoria = SCRIPT_CATEGORY;
    }

    // Unione: la nota esiste davvero?
    if (item.azione === 'unisci') {
      const target = await this.resolveExisting(item, tree);
      if (target) return this.mergeInto(op, now, item, target, attachments, cfg);
      item.azione = 'nuova';
    }

    // Materia e categoria (create se servono, senza chiedere).
    let subject = tree.find((s) => lc(s.name) === lc(sanitizeName(item.materia, 60)));
    if (!subject) {
      const name = sanitizeName(item.materia, 60);
      if (!name) throw new Error('Materia mancante.');
      subject = await this.createSubject(op, now, name, item.descrizioneMateria, tree);
      log.push(`🆕 creata materia [[${subject.name}]]`);
    }
    let category = subject.categories.find((c) => lc(c.name) === lc(sanitizeName(item.categoria, 50)));
    if (!category) {
      const name = sameNameElsewhere(tree, item.categoria) || sanitizeName(item.categoria, 50);
      if (!name) throw new Error('Categoria mancante.');
      category = await this.createCategory(op, now, subject, name, item.descrizioneCategoria || item.argomento);
      log.push(`🆕 creata categoria [[${subject.name} - ${category.name}]]`);
    }

    // Titolo unico (Obsidian collega per nome, Windows non distingue maiuscole).
    let title = sanitizeName(item.titolo) || sanitizeName(item.argomento) || 'Appunto';
    if (item.tipo === 'script' && !/^Script - /i.test(title)) title = sanitizeName(`Script - ${title}`);
    const sameTitle = findNoteByTitle(tree, title);
    if (sameTitle) {
      // Esiste già una nota con lo stesso nome: si unisce lì invece di duplicarla.
      return this.mergeInto(op, now, item, sameTitle, attachments, cfg);
    }
    if (names.has(lc(title))) title = uniqueTitle(title, `(${subject.name})`, names);
    const folderRel = `${DIRS.atomic}/${subject.name}/${category.folder}`;
    title = fitPath(this.root, folderRel, title);
    names.add(lc(title));

    const body = await this.withAttachments(op, now, item.contenuto, title, attachments);
    const indexName = `${subject.name} - ${category.name}`;
    const rel = `${folderRel}/${title}.md`;
    await this.writeText(op, rel, noteText({ date: `${now.date} ${now.time}`, tags: `[[${indexName}]]`, title, body, refs: `[[${indexName}]]` }));
    category.notes.push(title);
    await this.addToIndex(op, now, subject.name, category.name, title, item.argomento);
    log.push(`➕ creata [[${title}]]`);
    return { action: 'creata', materia: subject.name, categoria: category.name, titolo: title, rel, log };
  }

  async resolveExisting(item, tree) {
    const wanted = item.notaEsistente;
    if (wanted && wanted.startsWith(`${DIRS.atomic}/`) && wanted.toLowerCase().endsWith('.md') && (await this.exists(wanted))) {
      const parts = wanted.split('/');
      return { rel: wanted, title: path.posix.basename(wanted, '.md'), subject: parts[1], category: categoryParts(parts[2] || '').name };
    }
    const byName = wanted ? path.posix.basename(wanted, '.md') : item.titolo;
    return byName ? findNoteByTitle(tree, byName) : null;
  }

  async mergeInto(op, now, item, target, attachments, cfg) {
    const original = await this.readText(target.rel);
    const addition = await this.withAttachments(op, now, item.contenuto, target.title, attachments);
    let merged = null;
    try {
      const raw = await this.oneShot.run({
        system: MERGE_SYSTEM,
        prompt: `<nota_attuale>\n${original}\n</nota_attuale>\n\n<nuovo_contenuto>\n${addition}\n</nuovo_contenuto>`,
        model: cfg.mergeModel || 'main',
        effort: cfg.effort || 'medium',
      });
      merged = stripFences(raw);
      if (!merged.startsWith('\n')) merged = `\n${merged}`;
      merged = tidy(merged);
    } catch {
      merged = null;
    }
    const current = await this.readText(target.rel);
    if (current !== original) {
      // Modificata mentre il modello univa: tengo le modifiche e aggiungo in fondo.
      await this.writeText(op, target.rel, insertBeforeReferences(current, [`## Aggiunta ${now.date}`, '', addition]));
      return { action: 'aggiornata', materia: target.subject, categoria: target.category, titolo: target.title, rel: target.rel, log: [`✏️ aggiornata [[${target.title}]]`] };
    }
    const dateLine = original.split('\n').find((l) => l.trim());
    const ok =
      merged &&
      merged.split('\n').some((l) => l.trim() === `# ${target.title}`) &&
      /^# References\s*$/m.test(merged) &&
      merged.length >= original.length * 0.7 &&
      (!dateLine || merged.includes(dateLine.trim()));
    if (!ok) {
      // Controlli non superati: niente sovrascrittura, si aggiunge in fondo.
      merged = insertBeforeReferences(original, [`## Aggiunta ${now.date}`, '', addition]);
    }
    await this.writeText(op, target.rel, merged);
    // Il link nell'indice c'è già di solito; se manca lo si aggiunge.
    if (target.subject && target.category) await this.addToIndex(op, now, target.subject, target.category, target.title, '', true);
    return {
      action: 'aggiornata',
      materia: target.subject,
      categoria: target.category,
      titolo: target.title,
      rel: target.rel,
      log: [`✏️ aggiornata [[${target.title}]]`],
    };
  }

  /** Sostituisce i segnaposto di immagini e script con i file salvati nel vault. */
  async withAttachments(op, now, content, title, attachments) {
    let body = String(content || '');
    if (!attachments) return body;
    const short = sanitizeName(title, 40);
    let n = 0;
    for (const img of attachments.images) {
      let name;
      do {
        n++;
        name = `${now.date} ${short} ${n}.png`;
      } while (await this.exists(`${DIRS.images}/${name}`));
      await this.writeBinary(op, `${DIRS.images}/${name}`, Buffer.from(img.data, 'base64'));
      const embed = `![[${name}]]`;
      body = body.includes(img.tag) ? body.split(img.tag).join(embed) : `${body}\n\n${embed}`;
    }
    for (const s of attachments.scripts) {
      const ext = { python: '.py', py: '.py', mel: '.mel', javascript: '.js', js: '.js' }[lc(s.lang)] || '.py';
      const dir = sanitizeName(s.nomeScript || title.replace(/^Script - /i, ''), 60) || 'Script';
      let file = sanitizeName(s.nomeFile || `${dir.replace(/\s+/g, '_').toLowerCase()}${ext}`, 60);
      if (!path.extname(file)) file += ext;
      const rel = `${DIRS.source}/${dir}/${file}`;
      await this.writeText(op, rel, s.code);
      const tag = `{{${s.id}}}`;
      // Dentro una tabella il "|" dell'alias va scritto "\|", altrimenti spezza la riga.
      const link = (inTable) => `[[${rel}${inTable ? '\\|' : '|'}${file}]]`;
      body = body.includes(tag)
        ? body
            .split('\n')
            .map((l) => l.split(tag).join(link(l.trim().startsWith('|'))))
            .join('\n')
        : `${body}\n\nFile: ${link(false)}`;
    }
    return body;
  }

  async addToIndex(op, now, subject, category, title, topic, onlyIfMissing = false) {
    const rel = `${DIRS.indexes}/${subject} - ${category}.md`;
    const link = `[[${title}]]`;
    if (!(await this.exists(rel))) {
      const italic = topic ? `*${topic}.*` : '';
      const body = [italic, '', `- ${link}`].filter((l, i) => i > 0 || l).join('\n');
      await this.writeText(op, rel, noteText({ date: `${now.date} ${now.time}`, tags: `[[${subject}]]`, title: `${subject} - ${category}`, body, refs: `[[${subject}]]` }));
      return;
    }
    let text = await this.readText(rel);
    const has = text.split('\n').some((l) => lc(l).includes(lc(link)));
    if (has && onlyIfMissing) return;
    if (!has) text = appendListItem(text, `- ${link}`, (l) => /^- \[\[/.test(l));
    if (!onlyIfMissing) text = updateItalicLine(text, topic);
    await this.writeText(op, rel, text);
  }

  async createCategory(op, now, subject, name, description) {
    const max = subject.categories.reduce((m, c) => Math.max(m, c.num || 0), 0);
    const folder = `${pad2(max + 1)} ${name}`;
    await this.ensureDir(op, this.full(`${DIRS.atomic}/${subject.name}/${folder}`));
    const category = { folder, num: max + 1, name, notes: [] };
    subject.categories.push(category);
    // Indice della categoria: creato quando si aggiunge la prima nota (addToIndex).
    const tagRel = `${DIRS.tags}/${subject.name}.md`;
    const line = `- [[${subject.name} - ${name}]] – ${description || name}.`;
    if (await this.exists(tagRel)) {
      const text = await this.readText(tagRel);
      if (!lc(text).includes(lc(`[[${subject.name} - ${name}]]`))) {
        // In fondo all'elenco delle categorie: i numeri crescono nell'ordine di lavoro.
        await this.writeText(op, tagRel, appendListItem(text, line, (l) => l.startsWith(`- [[${subject.name} - `)));
      }
    }
    return category;
  }

  async createSubject(op, now, name, description, tree) {
    await this.ensureDir(op, this.full(`${DIRS.atomic}/${name}`));
    const subject = { name, categories: [] };
    const others = tree.map((s) => s.name);
    tree.push(subject);
    const tagRel = `${DIRS.tags}/${name}.md`;
    if (!(await this.exists(tagRel))) {
      const intro = `${description || name}. Macro-argomenti in ordine di lavoro:`;
      await this.writeText(
        op,
        tagRel,
        noteText({ date: `${now.date} ${now.time}`, tags: '', title: name, body: intro, refs: 'Vedi anche [[Come usare questo vault]]' })
      );
    }
    await this.addSubjectToGuide(op, name, others);
    return subject;
  }

  /** "Come usare questo vault": link nella riga References e nella riga dei soggetti della tabella. */
  async addSubjectToGuide(op, name, existingSubjects) {
    if (!(await this.exists(GUIDE_NOTE))) return;
    const text = await this.readText(GUIDE_NOTE);
    const link = `[[${name}]]`;
    if (text.includes(link)) return;
    const known = existingSubjects.map((s) => `[[${s}]]`);
    const lines = text.split('\n');
    const refs = lastHeadingIndex(lines, /^# References\s*$/);
    if (refs >= 0) {
      const i = lines.findIndex((l, idx) => idx > refs && l.includes('[['));
      if (i >= 0) {
        const updated = appendLinkToLine(lines[i], link, known);
        if (updated) lines[i] = updated;
      }
    }
    const row = lines.findIndex((l) => l.trim().startsWith('|') && known.some((k) => l.includes(k)));
    if (row >= 0) {
      const updated = appendLinkToLine(lines[row], link, known);
      if (updated) lines[row] = updated;
    }
    const next = lines.join('\n');
    if (next !== text) await this.writeText(op, GUIDE_NOTE, next);
  }

  // ---------------------------------------------- scorciatoie e strumenti

  /**
   * Dopo aver scritto una nota: le sue scorciatoie finiscono nella pagina
   * "4 - Indexes/{Materia} - Scorciatoie.md" (tabella Tasti | Cosa fa | Nota) e la
   * nota prende quel link nei Tags; gli strumenti citati in almeno 2 note hanno
   * una pagina "3 - Tags/Strumenti/{Strumento}.md" con tutte le note che li usano.
   */
  async updateHubs(op, now, item, done, log) {
    if (!done.materia || !done.titolo) return;
    const cell = (t) => String(t).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    if (item.scorciatoie.length) {
      const hubName = `${done.materia} - Scorciatoie`;
      const hubRel = `${DIRS.indexes}/${hubName}.md`;
      const link = `[[${done.titolo}]]`;
      let text = (await this.exists(hubRel))
        ? await this.readText(hubRel)
        : noteText({
            date: `${now.date} ${now.time}`,
            tags: `[[${done.materia}]]`,
            title: hubName,
            body: `*Tutte le scorciatoie di ${done.materia}, con la nota dove sono spiegate.*\n\n| Tasti | Cosa fa | Nota |\n| --- | --- | --- |`,
            refs: `[[${done.materia}]]`,
          });
      for (const k of item.scorciatoie) {
        const row = `| **${cell(k.tasti)}** | ${cell(k.azione)} | ${link} |`;
        const exists = text.split('\n').some((l) => lc(l).includes(lc(`**${cell(k.tasti)}**`)) && lc(l).includes(lc(link)));
        if (!exists) text = appendListItem(text, row, (l) => l.trim().startsWith('|'));
      }
      await this.writeText(op, hubRel, text);
      // La nota prende il "tag" della pagina scorciatoie nella riga Tags.
      const note = await this.readText(done.rel);
      if (!note.includes(`[[${hubName}]]`)) {
        await this.writeText(op, done.rel, note.replace(/^Tags: (.*)$/m, (m, t) => `Tags: ${t.trim()} [[${hubName}]]`.replace('Tags:  ', 'Tags: ')));
      }
    }
    if (item.strumenti.length) {
      const vault = this.getVault();
      await vault.ensureIndexed().catch(() => {});
      for (const tool of item.strumenti) {
        const needle = lc(`[[${tool}`);
        const users = new Set([done.titolo]);
        for (const n of vault.notes.values()) {
          if (n.rel.startsWith(`${DIRS.atomic}/`) && n.text.toLowerCase().includes(needle)) users.add(n.title);
        }
        if (users.size < 2) continue; // pagina solo per strumenti usati in almeno 2 note
        const rel = `${DIRS.tags}/Strumenti/${tool}.md`;
        let text = (await this.exists(rel))
          ? await this.readText(rel)
          : noteText({
              date: `${now.date} ${now.time}`,
              tags: done.materia ? `[[${done.materia}]]` : '',
              title: tool,
              body: `## Note che lo usano`,
              refs: done.materia ? `[[${done.materia}]]` : '',
            });
        const created = !(await this.exists(rel));
        for (const t of [...users].sort((a, b) => a.localeCompare(b))) {
          if (!lc(text).includes(lc(`[[${t}]]`))) text = appendListItem(text, `- [[${t}]]`, (l) => l.startsWith('- [['));
        }
        await this.writeText(op, rel, text);
        if (created) log.push(`🆕 creata pagina strumento [[${tool}]]`);
      }
    }
  }

  // ------------------------------------------------------------ registro

  roughRel(now) {
    return `${DIRS.rough}/${now.date}.md`;
  }

  async roughText(now) {
    const rel = this.roughRel(now);
    if (await this.exists(rel)) return this.readText(rel);
    return noteText({ date: `${now.date} ${now.time}`, tags: '', title: now.date, body: '', refs: '' });
  }

  async addLogLines(op, now, entries) {
    let text = await this.roughText(now);
    for (const e of entries) text = addToSection(text, 'Archiviato oggi', [`- ${now.time} ${e}`], false);
    await this.writeText(op, this.roughRel(now), text);
  }

  async addRough(op, now, question, content, reason) {
    let text = await this.roughText(now);
    const head = (question || 'Appunto').split('\n')[0].slice(0, 80);
    const block = [`### ${now.time} – ${head}`, ''];
    if (reason) block.push(`> ${reason}`, '');
    if (question) block.push(`**Domanda:** ${question}`, '');
    block.push(demoteHeadings(String(content || '').trim()) || '(vuoto)');
    text = addToSection(text, 'Da sistemare', block, true);
    await this.writeText(op, this.roughRel(now), text);
  }

  // --------------------------------------------------------------- annulla

  async undoNow(opId) {
    const op = this.ops.get(opId);
    if (!op) return { ok: false, error: 'Questa archiviazione non si può più annullare.' };
    if (op.undone) return { ok: false, error: 'Già annullata.' };
    const skipped = [];
    const { date } = romeNow();
    for (const entry of [...op.journal].reverse()) {
      const full = this.full(entry.rel, op.root); // il vault di allora, anche se poi è cambiato
      let current = null;
      try {
        current = await fsp.readFile(full);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          skipped.push(entry.rel); // non leggibile ora (bloccato): lo lascio com'è
          continue;
        }
      }
      const same =
        current === null ||
        (entry.afterHash
          ? crypto.createHash('sha1').update(current).digest('hex') === entry.afterHash
          : current.equals(Buffer.isBuffer(entry.after) ? entry.after : Buffer.from(String(entry.after), 'utf8')));
      if (!same) {
        skipped.push(entry.rel); // modificato dopo (es. in Obsidian): non lo tocco
        continue;
      }
      if (entry.before === null) {
        // Era nuovo: lo sposto nei backup (non lo cancello).
        if (current !== null) {
          const dest = path.join(this.backupRoot, date, 'annullati', ...entry.rel.split('/'));
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          await fsp.rename(full, dest).catch(async () => {
            await fsp.copyFile(full, dest);
            await fsp.unlink(full);
          });
        }
      } else {
        await this.atomicWrite(full, entry.before);
      }
    }
    for (const dir of [...op.createdDirs].reverse()) await fsp.rmdir(dir).catch(() => {}); // solo se vuote
    op.undone = true;
    const v = this.getVault();
    if (v) v.markChanged(op.journal.map((e) => e.rel));
    return { ok: true, skipped };
  }
}

// ------------------------------------------------------------ funzioni libere

async function listNotes(dir) {
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...(await listNotes(path.join(dir, e.name))));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(e.name.slice(0, -3));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function findNoteByTitle(tree, title) {
  const t = lc(sanitizeName(title));
  for (const s of tree) {
    for (const c of s.categories) {
      const hit = c.notes.find((n) => lc(n) === t);
      if (hit) return { rel: `${DIRS.atomic}/${s.name}/${c.folder}/${hit}.md`, title: hit, subject: s.name, category: c.name };
    }
  }
  return null;
}

function sameNameElsewhere(tree, name) {
  for (const s of tree) for (const c of s.categories) if (lc(c.name) === lc(name)) return c.name;
  return null;
}

function uniqueTitle(title, suffix, names) {
  // Il suffisso si aggiunge DOPO aver accorciato il titolo, altrimenti il taglio a 80
  // caratteri lo toglierebbe di nuovo e il ciclo non finirebbe mai.
  for (let n = 1; n < 1000; n++) {
    const tail = n === 1 ? ` ${suffix}` : ` ${suffix} ${n}`;
    const candidate = `${sanitizeName(title, MAX_TITLE - tail.length)}${tail}`;
    if (!names.has(lc(candidate))) return candidate;
  }
  return `${sanitizeName(title, MAX_TITLE - 12)} ${Date.now()}`;
}

function fitPath(root, folderRel, title) {
  const room = MAX_PATH - path.join(root, ...folderRel.split('/')).length - 5; // "\" + ".md" + margine
  if (title.length <= room) return title;
  return sanitizeName(title, Math.max(20, room));
}

function addToSection(text, heading, blockLines, spaced) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return insertBeforeReferences(text, [`## ${heading}`, '', ...blockLines]);
  let end = lines.length;
  let fence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence; // i "# commento" nel codice non sono titoli
    if (!fence && /^#{1,2} /.test(lines[i])) {
      end = i;
      break;
    }
  }
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  const insert = spaced ? ['', ...blockLines] : blockLines;
  if (at === start + 1) insert.unshift('');
  lines.splice(at, 0, ...insert);
  return tidy(lines.join('\n'));
}

/** I titoli "#"/"##" di un testo incollato diventano "####", fuori dai blocchi di codice. */
function demoteHeadings(text) {
  let fence = false;
  return text
    .split('\n')
    .map((l) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      return !fence && /^#{1,3} /.test(l) ? `#### ${l.replace(/^#+ /, '')}` : l;
    })
    .join('\n');
}

function classifyPrompt({ tree, related, question, answer, previous, images, scripts, kind }) {
  // Con un vault grande non si mandano tutti i titoli (costano a ogni archiviazione):
  // solo quelli delle categorie toccate dalle note simili o nominate nella domanda.
  const total = tree.reduce((n, s) => n + s.categories.reduce((m, c) => m + c.notes.length, 0), 0);
  const haystack = lc(`${question}\n${answer}`);
  const focus = new Set(related.map((n) => n.rel.split('/').slice(1, 3).join('/')));
  let budget = MAX_TREE_TITLES;
  const catLine = (s, c) => {
    if (!c.notes.length) return `  ${c.folder}: (vuota)`;
    const wanted =
      total <= MAX_TREE_TITLES || focus.has(`${s.name}/${c.folder}`) || haystack.includes(lc(c.name)) || haystack.includes(lc(s.name));
    if (!wanted || budget <= 0) return `  ${c.folder}: (${c.notes.length} note)`;
    const shown = c.notes.slice(0, budget);
    budget -= shown.length;
    return `  ${c.folder}: ${shown.join(' | ')}${shown.length < c.notes.length ? ' | …' : ''}`;
  };
  const treeText = tree.length
    ? tree
        .map((s) => `${s.name}\n${s.categories.length ? s.categories.map((c) => catLine(s, c)).join('\n') : '  (nessuna categoria)'}`)
        .join('\n')
    : '(il vault non ha ancora materie)';
  const parts = [`<albero_vault>\n${treeText}\n</albero_vault>`];
  if (related.length) {
    parts.push(
      `<note_simili>\n${related.map((n) => `--- ${n.rel}\n${n.text.slice(0, 1500)}`).join('\n\n')}\n</note_simili>`
    );
  }
  if (previous && previous.question) {
    parts.push(
      `<scambio_precedente>\nDomanda: ${previous.question}\nRisposta (inizio): ${String(previous.answer || '').slice(0, 1200)}\n</scambio_precedente>`
    );
  }
  if (kind === 'nota') {
    parts.push(`<appunto_utente>\n${answer}\n</appunto_utente>`);
  } else {
    parts.push(`<domanda>\n${question}\n</domanda>`, `<risposta>\n${answer}\n</risposta>`);
  }
  if (images.length) parts.push(`<allegati>${images.map((_, i) => `IMG${i + 1}`).join(', ')}</allegati>`);
  if (scripts.length) {
    parts.push(
      `<script_lunghi>\n${scripts
        .map((s) => `${s.id} (${s.lang}, ${s.lines} righe), inizio:\n${s.code.split('\n').slice(0, 40).join('\n')}`)
        .join('\n\n')}\n</script_lunghi>`
    );
  }
  return parts.join('\n\n');
}

module.exports = {
  Archivist,
  DIRS,
  // esportate per i test
  sanitizeName,
  parseItems,
  extractLongScripts,
  noteText,
  addToSection,
  updateItalicLine,
  appendListItem,
};
