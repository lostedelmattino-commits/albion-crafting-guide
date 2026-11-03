'use strict';
// Accesso diretto alla cartella del vault di Obsidian: ricerca, lettura e
// aggiunta di appunti. Non serve alcun plugin: le note sono file Markdown.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const RESCAN_MS = 20 * 1000;

class Vault {
  constructor(root) {
    this.root = root ? path.resolve(root) : '';
    /** @type {Map<string, {rel: string, title: string, folder: string, mtime: number, text: string, lower: string}>} */
    this.notes = new Map();
    this.lastScan = 0;
    this.scanning = null;
    this.generation = 0; // cresce a ogni invalidate(): una scansione già partita non conta più
  }

  get name() {
    return this.root ? path.basename(this.root) : '';
  }

  async ensureIndexed(force = false) {
    if (!this.root) throw new Error('Cartella del vault non impostata (⚙ → Vault Obsidian).');
    if (!force && Date.now() - this.lastScan < RESCAN_MS) return;
    if (!this.scanning) {
      this.scanning = this.scan().finally(() => {
        this.scanning = null;
      });
    }
    await this.scanning;
  }

  async scan() {
    const generation = this.generation;
    const seen = new Set();
    const walk = async (dir) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          const rel = path.relative(this.root, full).split(path.sep).join('/');
          seen.add(rel);
          let st;
          try {
            st = await fsp.stat(full);
          } catch {
            continue;
          }
          const prev = this.notes.get(rel);
          if (prev && prev.mtime === st.mtimeMs) continue;
          if (st.size > MAX_FILE_BYTES) continue;
          let text = '';
          try {
            text = await fsp.readFile(full, 'utf8');
          } catch {
            continue;
          }
          const title = e.name.slice(0, -3);
          const folder = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
          this.notes.set(rel, { rel, title, folder, mtime: st.mtimeMs, text, lower: plain(text) });
        }
      }
    };
    await fsp.access(this.root).catch(() => {
      throw new Error(`Cartella del vault non trovata: ${this.root}`);
    });
    await walk(this.root);
    for (const rel of [...this.notes.keys()]) if (!seen.has(rel)) this.notes.delete(rel);
    // Se nel frattempo qualcuno ha scritto nel vault, l'indice va rifatto alla prossima richiesta.
    this.lastScan = generation === this.generation ? Date.now() : 0;
  }

  /** Ricerca per titolo, percorso e contenuto. Query vuota = note modificate di recente. */
  async search(query, limit = 8) {
    await this.ensureIndexed();
    const q = plain(String(query || '').trim());
    const all = [...this.notes.values()];
    if (!q) {
      return all
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit)
        .map((n) => toResult(n, ''));
    }
    const terms = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const n of all) {
      const title = plain(n.title);
      const rel = plain(n.rel);
      let score = 0;
      let ok = true;
      for (const t of terms) {
        let s = 0;
        if (title === t) s += 40;
        else if (title.startsWith(t)) s += 20;
        else if (title.includes(t)) s += 12;
        if (rel.includes(t)) s += 3;
        const hits = countHits(n.lower, t, 6);
        s += hits * 2;
        if (s === 0) {
          ok = false;
          break;
        }
        score += s;
      }
      if (!ok) continue;
      if (title.includes(q)) score += 15; // frase intera nel titolo
      score += Math.max(0, 3 - (Date.now() - n.mtime) / (1000 * 60 * 60 * 24 * 30)); // piccolo bonus recenza
      scored.push({ n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ n }) => toResult(n, terms[0]));
  }

  async read(rel) {
    if (!this.root) throw new Error('Cartella del vault non impostata (⚙ → Vault Obsidian).');
    const full = this.safePath(rel);
    const text = await fsp.readFile(full, 'utf8');
    const name = path.basename(full, '.md');
    return { rel, title: name, folder: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), text };
  }

  /** Risolve un [[wikilink]] nel percorso relativo della nota. */
  async resolveLink(link) {
    await this.ensureIndexed();
    const target = String(link || '').split('|')[0].split('#')[0].trim().toLowerCase();
    if (!target) return null;
    const withExt = target.endsWith('.md') ? target : `${target}.md`;
    for (const n of this.notes.values()) if (n.rel.toLowerCase() === withExt) return n.rel;
    for (const n of this.notes.values()) if (n.title.toLowerCase() === path.posix.basename(target)) return n.rel;
    return null;
  }

  /**
   * Le note più pertinenti per una domanda (sezione 6 del brief): parole chiave della
   * domanda cercate in titoli, percorsi e testo. Ritorna al massimo `limit` note.
   * @param {string[]} excludePrefixes cartelle da ignorare (es. "1 - Rough Notes")
   */
  async relevant(query, limit = 3, excludePrefixes = []) {
    await this.ensureIndexed();
    const terms = keywords(query);
    if (!terms.length) return [];
    const scored = [];
    for (const n of this.notes.values()) {
      if (excludePrefixes.some((p) => n.rel.startsWith(`${p}/`))) continue;
      const title = plain(n.title);
      const rel = plain(n.rel);
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        let s = 0;
        if (title.includes(t)) s += 6;
        else if (rel.includes(t)) s += 2;
        s += Math.min(countHits(n.lower, t, 5), 5);
        if (s > 0) matched++;
        score += s;
      }
      if (!matched) continue;
      score *= 0.5 + matched / terms.length; // premia le note che coprono più parole
      if (score >= 6) scored.push({ n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ n }) => ({ rel: n.rel, title: n.title, text: n.text }));
  }

  /** Tutti i nomi di nota (senza .md, minuscoli): Obsidian collega le note per nome. */
  async noteNames() {
    await this.ensureIndexed();
    return new Set([...this.notes.values()].map((n) => n.title.toLowerCase()));
  }

  invalidate() {
    this.lastScan = 0;
    this.generation++;
  }

  /** Percorso di un allegato (es. immagine di ![[nome.png]]): prima Images/, poi tutto il vault. */
  async resolveAsset(name) {
    if (!this.root) return null;
    const clean = String(name || '').split('|')[0].split('#')[0].trim().replace(/\\/g, '/');
    if (!clean || clean.split('/').some((p) => p === '..' || p === '.obsidian')) return null;
    for (const rel of [clean, `Images/${path.posix.basename(clean)}`]) {
      try {
        const full = this.safePath(rel);
        if ((await fsp.stat(full)).isFile()) return full;
      } catch {
        // non qui
      }
    }
    const wanted = path.posix.basename(clean).toLowerCase();
    const walk = async (dir) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isFile() && e.name.toLowerCase() === wanted) return full;
        if (e.isDirectory()) {
          const hit = await walk(full);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(this.root);
  }

  safePath(rel) {
    const full = path.resolve(this.root, String(rel));
    const inside = full === this.root || full.startsWith(this.root + path.sep);
    if (!inside) throw new Error('Percorso fuori dal vault.');
    return full;
  }
}

function toResult(n, term) {
  return { rel: n.rel, title: n.title, folder: n.folder, mtime: n.mtime, snippet: snippet(n, term) };
}

function snippet(n, term) {
  const body = stripFrontmatter(n.text);
  const lower = body.toLowerCase();
  let i = term ? lower.indexOf(term) : -1;
  if (i < 0) i = 0;
  const start = Math.max(0, i - 50);
  let s = body.slice(start, start + 160).replace(/\s+/g, ' ').trim();
  if (start > 0) s = `…${s}`;
  if (start + 160 < body.length) s += '…';
  return s;
}

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end < 0 ? text : text.slice(end + 4);
}

function countHits(hay, needle, max) {
  let count = 0;
  let i = hay.indexOf(needle);
  while (i >= 0 && count < max) {
    count++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return count;
}

// Minuscolo e senza accenti, per confronti più tolleranti ("perché" = "perche").
function plain(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const STOPWORDS = new Set(
  (
    'il lo la le gli un uno una di da in con su per tra fra e ed o od ma che chi come cosa cos quando dove perche ' +
    'non si mi ti ci vi ne del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle ' +
    'nel nello nella nei negli nelle sul sullo sulla sui sugli sulle col coi e sono era essere ho hai ha abbiamo hanno ' +
    'fare faccio fa fai posso puoi puo devo deve voglio vorrei serve questo questa questi queste quello quella quelli ' +
    'quelle mio mia miei mie tuo tua suo sua anche piu molto tutto tutti ogni quale quali quanto quanti modo meglio ' +
    'poi gia ancora solo senza dopo prima sempre mai allora quindi pero oppure qualcosa qualche altro altra ' +
    'the and for with how what why when where can does into from this that'
  ).split(' ')
);

function keywords(text) {
  const words = plain(text)
    .replace(/[^\p{L}\p{N}\s+-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 25);
}

module.exports = { Vault, stripFrontmatter };
