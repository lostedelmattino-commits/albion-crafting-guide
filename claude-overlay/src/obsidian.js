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
          this.notes.set(rel, { rel, title, folder, mtime: st.mtimeMs, text, lower: text.toLowerCase() });
        }
      }
    };
    await fsp.access(this.root).catch(() => {
      throw new Error(`Cartella del vault non trovata: ${this.root}`);
    });
    await walk(this.root);
    for (const rel of [...this.notes.keys()]) if (!seen.has(rel)) this.notes.delete(rel);
    this.lastScan = Date.now();
  }

  /** Ricerca per titolo, percorso e contenuto. Query vuota = note modificate di recente. */
  async search(query, limit = 8) {
    await this.ensureIndexed();
    const q = String(query || '').trim().toLowerCase();
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
      const title = n.title.toLowerCase();
      const rel = n.rel.toLowerCase();
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
    await this.ensureIndexed();
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

  /** Aggiunge un appunto alla nota del giorno nella cartella inbox. */
  async append(text, folder) {
    if (!this.root) throw new Error('Cartella del vault non impostata (⚙ → Vault Obsidian).');
    const now = new Date();
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const relDir = sanitizeFolder(folder);
    const rel = (relDir ? `${relDir}/` : '') + `${day}.md`;
    const full = this.safePath(rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    let prefix = '';
    try {
      await fsp.access(full);
    } catch {
      prefix = `# ${day}\n`;
    }
    await fsp.appendFile(full, `${prefix}\n## ${time}\n${String(text).trim()}\n`, 'utf8');
    this.lastScan = 0; // forza la reindicizzazione alla prossima ricerca
    return rel;
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

function sanitizeFolder(folder) {
  return String(folder || '')
    .split(/[\\/]+/)
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

module.exports = { Vault, stripFrontmatter };
