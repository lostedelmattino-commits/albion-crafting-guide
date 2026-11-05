'use strict';
// Conversazione con Claude tramite l'SDK ufficiale (@anthropic-ai/sdk), in streaming.
// Gira nel processo main: la chiave API non arriva mai al renderer.

const { Anthropic } = require('@anthropic-ai/sdk');

// Modelli che accettano il fallback lato server (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

const BASE_SYSTEM = [
  "Stai rispondendo dentro un piccolo overlay flottante sul desktop dell'utente, usato per domande veloci e per prendere appunti.",
  "Rispondi nella lingua dell'utente. Vai dritto al punto: prima la risposta, poi eventuali dettagli.",
  'Usa Markdown leggero (elenchi, grassetto, blocchi di codice) solo quando aiuta la lettura in uno spazio stretto.',
  "Se l'utente allega una nota di Obsidian, usala come contesto principale.",
].join('\n');

class ClaudeChat {
  /**
   * @param {() => {model: string, effort: string, systemPrompt: string}} getConfig
   * @param {() => string} getApiKey
   */
  constructor(getConfig, getApiKey) {
    this.getConfig = getConfig;
    this.getApiKey = getApiKey;
    /** @type {import('@anthropic-ai/sdk').Anthropic.Beta.BetaMessageParam[]} */
    this.history = [];
    this.stream = null;
  }

  reset() {
    this.abort();
    this.history = [];
  }

  abort() {
    if (this.stream) {
      this.stream.abort();
      this.stream = null;
    }
  }

  client() {
    const key = this.getApiKey();
    // Senza chiave salvata l'SDK usa ANTHROPIC_API_KEY o un profilo `ant auth login`.
    return key ? new Anthropic({ apiKey: key }) : new Anthropic();
  }

  /**
   * Invia un messaggio e chiama onText(delta) man mano che arriva il testo.
   * Ritorna { ok, text, stopReason, model } oppure { ok: false, error, aborted }.
   */
  async send(userContent, onText) {
    const cfg = this.getConfig();
    this.abort();
    this.history.push({ role: 'user', content: userContent });

    const system = cfg.systemPrompt ? `${BASE_SYSTEM}\n\n${cfg.systemPrompt}` : BASE_SYSTEM;
    const params = {
      model: cfg.model,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: cfg.effort || 'low' },
      system,
      cache_control: { type: 'ephemeral' }, // caching automatico della cronologia
      messages: [...this.history],
    };
    if (FALLBACK_MODELS.has(cfg.model)) {
      // Se i classificatori di sicurezza rifiutano, l'API riprova da sola sul modello consigliato.
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }

    let client;
    try {
      client = this.client();
    } catch {
      this.history.pop();
      return { ok: false, error: 'Nessuna chiave API configurata. Aggiungila dalle impostazioni (⚙).' };
    }

    let stream;
    try {
      stream = client.beta.messages.stream(params);
      this.stream = stream;
      stream.on('text', (delta) => onText(delta));
      const message = await stream.finalMessage();
      if (this.stream === stream) this.stream = null;

      if (message.stop_reason === 'refusal') {
        this.history.pop(); // il turno rifiutato non entra nella cronologia
        const cat = message.stop_details && message.stop_details.category;
        return {
          ok: false,
          error: `Claude ha rifiutato questa richiesta${cat ? ` (categoria: ${cat})` : ''}. Prova a riformularla.`,
        };
      }

      this.history.push({ role: 'assistant', content: echoableContent(message.content) });
      const text = message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { ok: true, text, stopReason: message.stop_reason, model: message.model };
    } catch (err) {
      if (this.stream === stream) this.stream = null;
      // Il messaggio senza risposta viene tolto, così si può semplicemente riprovare.
      const last = this.history[this.history.length - 1];
      if (last && last.role === 'user') this.history.pop();
      return { ok: false, aborted: err instanceof Anthropic.APIUserAbortError, error: describeError(err) };
    }
  }
}

// Dopo un fallback a metà risposta, i blocchi interni del modello che ha rifiutato
// (thinking, tool_use, ...) prima dell'ultimo blocco `fallback` non vanno rimandati.
function echoableContent(content) {
  let last = -1;
  content.forEach((b, i) => {
    if (b.type === 'fallback') last = i;
  });
  if (last < 0) return content;
  return content.filter((b, i) => i > last || b.type === 'text');
}

function describeError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return 'Interrotto.';
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Chiave API non valida o mancante. Aprila dalle impostazioni (⚙) e incollala di nuovo.';
  }
  if (err instanceof Anthropic.PermissionDeniedError) return 'La chiave API non ha accesso a questo modello.';
  if (err instanceof Anthropic.NotFoundError) return 'Modello non trovato: controlla il nome nelle impostazioni.';
  if (err instanceof Anthropic.RateLimitError) return 'Troppe richieste: aspetta qualche secondo e riprova.';
  if (err instanceof Anthropic.BadRequestError) return `Richiesta non valida: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return 'Il servizio è momentaneamente sovraccarico. Riprova tra poco.';
  if (err instanceof Anthropic.APIConnectionError) return 'Connessione non riuscita. Controlla la rete.';
  if (err instanceof Anthropic.APIError) return `Errore API ${err.status ?? ''}: ${err.message}`;
  if (err instanceof Anthropic.AnthropicError) {
    // Tipicamente: nessuna credenziale (né chiave salvata, né ANTHROPIC_API_KEY).
    return `${err.message}\n\nSe non hai ancora inserito la chiave API, aggiungila dalle impostazioni (⚙).`;
  }
  return `Errore: ${err && err.message ? err.message : String(err)}`;
}

module.exports = { ClaudeChat, echoableContent };
