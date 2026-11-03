'use strict';
// Impostazioni persistenti (config.json nella cartella dati dell'app).
// La chiave API viene cifrata con safeStorage (DPAPI su Windows) quando disponibile.

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  corner: 'bottom-right', // bottom-right | bottom-left | top-right | top-left
  margin: 18,
  width: 440,
  expandedWidth: 580,
  expandedHeight: 620,
  opacity: 0.86, // opacità dello sfondo del pannello
  ghostOpacity: 0.5, // opacità dell'intera finestra in modalità fantasma
  autoHideSeconds: 12, // dopo la risposta, quanto resta visibile se non fissata
  noteDisplaySeconds: 15, // quanto resta visibile una nota aperta se non fissata
  hotkeyChat: 'CommandOrControl+Shift+Space',
  hotkeyNotes: 'CommandOrControl+Shift+O',
  hotkeyGhost: 'CommandOrControl+Shift+G',
  // 'subscription' = tramite Claude Code con il tuo abbonamento Pro/Max (nessun costo extra)
  // 'api' = chiave API Anthropic, a consumo
  backend: 'subscription',
  claudePath: '', // percorso di Claude Code, se non viene trovato da solo
  ccModel: 'default', // default | opus | sonnet | haiku | fable (modalità abbonamento)
  webSearch: true, // modalità abbonamento: Claude può cercare sul web
  model: 'claude-opus-5-5', // modalità chiave API
  effort: 'low', // low = risposte rapide; alza a medium/high per domande difficili
  systemPrompt: '',
  vaultPath: '',
  inboxFolder: 'Claude Overlay',
  startAtLogin: false,
  apiKeyEnc: '',
  apiKeyPlain: '', // usato solo se safeStorage non è disponibile
};

const PUBLIC_KEYS = Object.keys(DEFAULTS).filter((k) => !k.startsWith('apiKey'));

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  if (cache) return cache;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    // primo avvio o file illeggibile: si parte dai default
  }
  cache = { ...DEFAULTS, ...data };
  return cache;
}

function persist() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8');
}

function get() {
  return load();
}

// Vista sicura da passare al renderer: niente chiave, solo se è impostata.
function publicView() {
  const c = load();
  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = c[k];
  out.hasApiKey = Boolean(getApiKey());
  out.apiKeyFromEnv = !c.apiKeyEnc && !c.apiKeyPlain && Boolean(process.env.ANTHROPIC_API_KEY);
  out.platform = process.platform;
  return out;
}

function update(patch) {
  const c = load();
  for (const [k, v] of Object.entries(patch || {})) {
    if (!PUBLIC_KEYS.includes(k)) continue;
    const def = DEFAULTS[k];
    if (typeof def === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) c[k] = n;
    } else if (typeof def === 'boolean') {
      c[k] = Boolean(v);
    } else {
      c[k] = String(v ?? '');
    }
  }
  c.opacity = clamp(c.opacity, 0.25, 1);
  c.ghostOpacity = clamp(c.ghostOpacity, 0.15, 1);
  c.autoHideSeconds = clamp(c.autoHideSeconds, 2, 600);
  c.noteDisplaySeconds = clamp(c.noteDisplaySeconds, 2, 600);
  c.width = clamp(c.width, 320, 900);
  c.expandedWidth = clamp(c.expandedWidth, 360, 1400);
  c.expandedHeight = clamp(c.expandedHeight, 240, 1400);
  c.margin = clamp(c.margin, 0, 200);
  if (!['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(c.corner)) c.corner = DEFAULTS.corner;
  if (!['subscription', 'api'].includes(c.backend)) c.backend = DEFAULTS.backend;
  if (!['default', 'opus', 'sonnet', 'haiku', 'fable'].includes(c.ccModel)) c.ccModel = DEFAULTS.ccModel;
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(c.effort)) c.effort = DEFAULTS.effort;
  persist();
  return c;
}

function setApiKey(key) {
  const c = load();
  key = String(key || '').trim();
  c.apiKeyEnc = '';
  c.apiKeyPlain = '';
  if (key) {
    if (safeStorage.isEncryptionAvailable()) {
      c.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
    } else {
      c.apiKeyPlain = key;
    }
  }
  persist();
}

function getApiKey() {
  const c = load();
  if (c.apiKeyEnc) {
    try {
      return safeStorage.decryptString(Buffer.from(c.apiKeyEnc, 'base64'));
    } catch {
      return '';
    }
  }
  return c.apiKeyPlain || '';
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

module.exports = { get, publicView, update, setApiKey, getApiKey, DEFAULTS };
