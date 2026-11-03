'use strict';
// Collegamento tramite Claude Code (la CLI ufficiale `claude`): usa l'account con cui
// hai fatto l'accesso a Claude Code, quindi il tuo abbonamento Pro/Max, senza chiave API.
// Un processo `claude -p` in modalità stream-json resta aperto per la conversazione:
// i messaggi entrano da stdin come righe JSON e il testo esce in streaming da stdout.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const IDLE_MS = 10 * 60 * 1000; // chiude il processo dopo 10 minuti di inattività

const BASE_SYSTEM = [
  "Stai rispondendo dentro un piccolo overlay flottante sul desktop dell'utente, usato per domande veloci e per prendere appunti.",
  "Rispondi nella lingua dell'utente. Vai dritto al punto: prima la risposta, poi eventuali dettagli.",
  'Usa Markdown leggero (elenchi, grassetto, blocchi di codice) solo quando aiuta la lettura in uno spazio stretto.',
  "Se l'utente allega una nota di Obsidian, usala come contesto principale.",
  'Non hai accesso ai file del computer: se servono informazioni aggiornate puoi cercare sul web, quando lo strumento è disponibile.',
].join('\n');

/** Trova l'eseguibile di Claude Code. */
function findClaude(custom) {
  // Un percorso scelto a mano vale da solo: se è sbagliato è meglio dirlo che usarne un altro.
  if (custom) return fileExists(custom) ? custom : null;
  const candidates = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      candidates.push(...out.split(/\r?\n/).filter((p) => /\.(exe|cmd|bat)$/i.test(p)).sort(byExe));
    } catch {
      // `where` non trova nulla: si provano i percorsi standard
    }
    candidates.push(path.join(home, '.local', 'bin', 'claude.exe'));
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
  } else {
    try {
      candidates.push(execFileSync('which', ['claude'], { encoding: 'utf8', timeout: 5000 }).trim());
    } catch {
      // non nel PATH
    }
    candidates.push(
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, '.claude', 'local', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude'
    );
  }
  return candidates.find((p) => p && fileExists(p)) || null;
}

function byExe(a, b) {
  return Number(/\.exe$/i.test(b)) - Number(/\.exe$/i.test(a));
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Avvia l'eseguibile; i file .cmd di npm su Windows richiedono la shell. */
function launch(exe, args, options) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    const quote = (a) => (a === '' ? '""' : /[\s&()^|<>"%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return spawn(`"${exe}"`, args.map(quote), { ...options, shell: true });
  }
  return spawn(exe, args, options);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Con la shell, kill() chiuderebbe solo cmd.exe: taskkill /T chiude anche Claude Code.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  } else {
    child.kill('SIGTERM');
  }
}

/** Ambiente per Claude Code: senza chiavi API, così usa l'accesso con l'abbonamento. */
function subscriptionEnv() {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ELECTRON_RUN_AS_NODE', 'CLAUDECODE']) delete env[k];
  return env;
}

/** Controlla che Claude Code sia installato (non verifica l'accesso: quello emerge alla prima domanda). */
function checkClaudeCode(custom) {
  const exe = findClaude(custom);
  if (!exe) {
    return Promise.resolve({
      ok: false,
      error: custom ? `Nessun file in ${custom}.` : 'Claude Code non trovato su questo PC.',
    });
  }
  return new Promise((resolve) => {
    let out = '';
    const child = launch(exe, ['--version'], { env: subscriptionEnv(), windowsHide: true });
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ ok: false, path: exe, error: 'Claude Code non risponde.' });
    }, 15000);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, path: exe, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const version = out.trim().split('\n')[0].replace(/\s*\(Claude Code\)\s*$/i, '');
      if (code === 0) resolve({ ok: true, path: exe, version });
      else resolve({ ok: false, path: exe, error: `Claude Code è uscito con codice ${code}.` });
    });
  });
}

class ClaudeCodeChat {
  /**
   * @param {() => object} getConfig
   * @param {string} workDir cartella vuota usata come directory di lavoro (niente CLAUDE.md di progetto)
   */
  constructor(getConfig, workDir) {
    this.getConfig = getConfig;
    this.workDir = workDir;
    this.child = null;
    this.signature = '';
    this.sessionId = null;
    this.pending = null;
    this.stderr = '';
    this.rateLimit = null;
    this.idleTimer = null;
  }

  argsFor(cfg) {
    fs.mkdirSync(this.workDir, { recursive: true });
    const systemFile = path.join(this.workDir, 'system-prompt.md');
    const system = cfg.systemPrompt ? `${BASE_SYSTEM}\n\n${cfg.systemPrompt}` : BASE_SYSTEM;
    fs.writeFileSync(systemFile, system, 'utf8');
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--system-prompt-file', systemFile,
      '--strict-mcp-config',
      '--disable-slash-commands',
    ];
    // Solo ricerca web (facoltativa): nessuno strumento che tocchi file o comandi.
    const tools = cfg.webSearch ? 'WebSearch,WebFetch' : '';
    args.push('--tools', tools);
    if (tools) args.push('--allowedTools', tools);
    if (cfg.ccModel && cfg.ccModel !== 'default') args.push('--model', cfg.ccModel);
    if (cfg.effort) args.push('--effort', cfg.effort);
    return args;
  }

  /** Avvia il processo in anticipo, così la prima risposta arriva prima. */
  warm() {
    if (this.pending) return;
    try {
      this.ensureProcess();
    } catch {
      // l'errore verrà mostrato al primo invio
    }
  }

  ensureProcess() {
    const cfg = this.getConfig();
    const signature = JSON.stringify([cfg.claudePath, cfg.ccModel, cfg.effort, cfg.webSearch, cfg.systemPrompt]);
    if (this.child && this.signature !== signature) this.stop(); // impostazioni cambiate: riparte riprendendo la conversazione
    if (this.child) return;

    const exe = findClaude(cfg.claudePath);
    if (!exe) throw new Error(NOT_FOUND);
    const args = this.argsFor(cfg);
    if (this.sessionId) args.push('--resume', this.sessionId);

    const child = launch(exe, args, {
      cwd: this.workDir,
      env: subscriptionEnv(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.signature = signature;
    this.stderr = '';

    readline.createInterface({ input: child.stdout }).on('line', (line) => this.onLine(child, line));
    child.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-4000);
    });
    child.stdin.on('error', () => {}); // processo già chiuso: gestito in 'close'
    child.on('error', (err) => this.onExit(child, err.code === 'ENOENT' ? NOT_FOUND : err.message));
    child.on('close', (code) => this.onExit(child, `Claude Code si è chiuso (codice ${code}). ${this.stderr.trim()}`.trim()));
    this.touch();
  }

  onLine(child, line) {
    if (child !== this.child) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // righe non JSON (log): ignorate
    }
    const p = this.pending;
    if (msg.session_id) this.sessionId = msg.session_id;

    if (msg.type === 'rate_limit_event') {
      this.rateLimit = msg.rate_limit_info || null;
      return;
    }
    if (!p) return;

    if (msg.type === 'stream_event' && msg.event && !msg.parent_tool_use_id) {
      const ev = msg.event;
      if (ev.type === 'message_start' && p.text) p.needSep = true;
      if (ev.type === 'content_block_start' && ev.content_block) {
        const t = ev.content_block.type;
        if (t === 'server_tool_use' || t === 'tool_use') p.onStatus && p.onStatus('Cerco sul web…');
      }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        let delta = ev.delta.text;
        if (p.needSep) {
          delta = `\n\n${delta}`;
          p.needSep = false;
        }
        p.text += delta;
        p.onText(delta);
      }
      return;
    }

    if (msg.type === 'result') {
      this.pending = null;
      this.touch();
      if (msg.is_error || msg.subtype !== 'success') {
        const detail = msg.result || (Array.isArray(msg.errors) ? msg.errors.join('\n') : '') || msg.subtype;
        p.resolve({ ok: false, error: friendlyError(detail, this.rateLimit) });
      } else {
        p.resolve({ ok: true, text: p.text || msg.result || '', stopReason: msg.stop_reason });
      }
    }
  }

  onExit(child, reason) {
    if (child !== this.child) return;
    this.child = null;
    clearTimeout(this.idleTimer);
    const p = this.pending;
    this.pending = null;
    if (p) p.resolve({ ok: false, error: friendlyError(reason, this.rateLimit) });
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.pending) this.stop();
    }, IDLE_MS);
  }

  stop() {
    const child = this.child;
    this.child = null;
    clearTimeout(this.idleTimer);
    killTree(child);
  }

  abort() {
    const p = this.pending;
    this.pending = null;
    this.stop(); // la conversazione riprende con --resume al prossimo messaggio
    if (p) p.resolve({ ok: false, aborted: true, error: 'Interrotto.' });
  }

  reset() {
    this.abort();
    this.sessionId = null;
  }

  dispose() {
    this.abort();
  }

  send(content, onText, onStatus) {
    if (this.pending) this.abort();
    try {
      this.ensureProcess();
    } catch (err) {
      return Promise.resolve({ ok: false, error: err.message });
    }
    return new Promise((resolve) => {
      this.pending = { resolve, onText, onStatus, text: '', needSep: false };
      const line = JSON.stringify({ type: 'user', message: { role: 'user', content } });
      this.child.stdin.write(`${line}\n`);
    });
  }
}

const NOT_FOUND =
  'Claude Code non trovato. Installalo (vedi README: in PowerShell `irm https://claude.ai/install.ps1 | iex`), ' +
  'poi apri un terminale, esegui `claude` e accedi con il tuo account Claude. ' +
  'Se è installato in un percorso diverso, indicalo nelle impostazioni (⚙).';

function friendlyError(detail, rateLimit) {
  let msg = String(detail || 'Errore sconosciuto.').trim();
  if (rateLimit && rateLimit.status === 'rejected') {
    const when = rateLimit.resetsAt ? new Date(rateLimit.resetsAt * 1000).toLocaleString('it-IT') : '';
    msg = `Hai raggiunto il limite di utilizzo del tuo piano${when ? ` (si azzera il ${when})` : ''}.\n\n${msg}`;
  }
  return (
    `${msg}\n\nSe non hai ancora fatto l'accesso: apri un terminale, esegui \`claude\` ` +
    'e accedi con il tuo account Claude (Pro o Max).'
  );
}

module.exports = { ClaudeCodeChat, checkClaudeCode, findClaude, launch, killTree, subscriptionEnv };
