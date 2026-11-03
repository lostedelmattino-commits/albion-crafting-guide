'use strict';
// Chiamate "una tantum" a Claude per l'archiviazione (classificazione e unione delle note),
// separate dalla conversazione. Usano lo stesso collegamento scelto nelle impostazioni:
// abbonamento tramite Claude Code oppure chiave API.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Anthropic } = require('@anthropic-ai/sdk');
const { findClaude, launch, killTree, subscriptionEnv } = require('./claude-code');

const API_MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
const API_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

class OneShot {
  /**
   * @param {() => object} getConfig
   * @param {() => string} getApiKey
   * @param {string} workDir cartella di lavoro vuota per Claude Code
   */
  constructor(getConfig, getApiKey, workDir) {
    this.getConfig = getConfig;
    this.getApiKey = getApiKey;
    this.workDir = workDir;
  }

  /**
   * @param {{system: string, prompt: string, model: 'haiku'|'sonnet'|'opus'|'main', effort?: string, timeoutMs?: number}} req
   * @returns {Promise<string>} il testo della risposta
   */
  run(req) {
    const cfg = this.getConfig();
    return cfg.backend === 'api' ? this.viaApi(cfg, req) : this.viaClaudeCode(cfg, req);
  }

  async viaApi(cfg, { system, prompt, model, effort = 'low' }) {
    const key = this.getApiKey();
    const client = key ? new Anthropic({ apiKey: key }) : new Anthropic();
    const modelId = model === 'main' ? cfg.model : API_MODELS[model] || API_MODELS.haiku;
    const params = {
      model: modelId,
      max_tokens: 32000,
      system,
      output_config: { effort },
      messages: [{ role: 'user', content: prompt }],
    };
    if (API_FALLBACK_MODELS.has(modelId)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    const message = await client.beta.messages.stream(params).finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Claude ha rifiutato la richiesta di archiviazione.');
    return message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  viaClaudeCode(cfg, { system, prompt, model, effort = 'low', timeoutMs = 4 * 60 * 1000 }) {
    const exe = findClaude(cfg.claudePath);
    if (!exe) return Promise.reject(new Error('Claude Code non trovato.'));
    fs.mkdirSync(this.workDir, { recursive: true });
    const systemFile = path.join(this.workDir, `system-${crypto.randomUUID()}.md`);
    fs.writeFileSync(systemFile, system, 'utf8');

    const alias = model === 'main' ? (cfg.ccModel && cfg.ccModel !== 'default' ? cfg.ccModel : null) : model;
    const args = [
      '-p',
      '--output-format', 'json',
      '--no-session-persistence',
      '--tools', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--system-prompt-file', systemFile,
      '--effort', effort,
    ];
    if (alias) args.push('--model', alias);

    return new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fs.promises.unlink(systemFile).catch(() => {});
        fn(value);
      };
      const child = launch(exe, args, {
        cwd: this.workDir,
        env: subscriptionEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        killTree(child);
        finish(reject, new Error('Claude Code non ha risposto in tempo.'));
      }, timeoutMs);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
      child.stdin.on('error', () => {});
      child.on('error', (e) => finish(reject, e));
      child.on('close', (code) => {
        const result = lastResult(out);
        if (!result) {
          finish(reject, new Error(`Claude Code è uscito senza risposta (codice ${code}). ${err.trim()}`.trim()));
        } else if (result.is_error || (result.subtype && result.subtype !== 'success')) {
          finish(reject, new Error(String(result.result || result.subtype || 'Errore di Claude Code.')));
        } else {
          finish(resolve, String(result.result ?? ''));
        }
      });
      child.stdin.end(prompt, 'utf8');
    });
  }
}

/** Con --output-format json Claude Code stampa un oggetto risultato (di solito l'ultima riga). */
function lastResult(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj && obj.type === 'result') return obj;
      } catch {
        // riga non JSON
      }
    }
    return null;
  }
}

module.exports = { OneShot };
