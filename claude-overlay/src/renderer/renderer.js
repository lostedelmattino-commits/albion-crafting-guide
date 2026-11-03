'use strict';
/* global Markdown */
(() => {
  const api = window.overlay;
  const $ = (id) => document.getElementById(id);

  const shell = $('shell');
  const panel = $('panel');
  const input = $('input');
  const content = $('content');
  const chatLog = $('chat-log');
  const olderBtn = $('older');
  const results = $('note-results');
  const noteView = $('note-view');
  const noteBody = $('note-body');
  const timerEl = $('timer');
  const timerFill = $('timer-fill');
  const statusEl = $('status');
  const toastEl = $('toast');
  const form = $('settings');
  const micBtn = $('btn-mic');
  const sendBtn = $('btn-send');

  const MODEL_NAMES = {
    'claude-opus-5-5': 'Opus 5.5',
    'claude-sonnet-5-5': 'Sonnet 5.5',
    'claude-haiku-5-5': 'Haiku 5.5',
    'claude-fable-5-1': 'Fable 5.1',
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
    fable: 'Fable',
  };
  const EFFORT_NAMES = { low: 'rapido', medium: 'bilanciato', high: 'accurato', xhigh: 'molto accurato' };

  const state = {
    mode: 'chat',
    view: 'compact',
    pinned: false,
    ghost: false,
    streaming: false,
    visible: false,
    hovering: false,
    holdUntil: 0, // non nascondere su blur fino a questo istante (dialoghi, dettatura)
    config: {},
    layout: { corner: 'bottom-right', maxHeight: 900, maxWidth: 1600 },
    context: null, // nota allegata alla prossima domanda: { rel, title }
    notes: { results: [], selected: 0, current: null },
    modeBeforeSettings: 'chat',
    drafts: { chat: '', notes: '' }, // testo in sospeso per ciascuna modalità
    attachments: [], // immagini incollate: { full, model: {data, mediaType}, thumb }
    lastExchange: null, // domanda/risposta precedente (contesto per l'archiviazione)
    interactive: null, // in modalità fantasma: true mentre tieni premuto Ctrl
    warnedHotkeys: false,
    panelW: 440,
  };

  // ------------------------------------------------------------ layout

  function applyLayout() {
    const c = state.config;
    const L = state.layout;
    shell.classList.toggle('anchor-top', String(L.corner).startsWith('top'));
    shell.classList.toggle('anchor-left', String(L.corner).endsWith('left'));
    const css = document.documentElement.style;
    css.setProperty('--alpha', String(c.opacity ?? 0.86));
    css.setProperty('--ghost-alpha', String(c.ghostOpacity ?? 0.7));
    const chrome = 118; // barra + campo di testo + margini
    const maxPanelH = Math.max(260, Math.min(c.expandedHeight || 620, L.maxHeight - 20));
    css.setProperty('--expanded-h', `${maxPanelH - chrome}px`);
    css.setProperty('--preview-h', `${Math.min(260, maxPanelH - chrome)}px`);
    updateWidth();
  }

  function updateWidth() {
    const c = state.config;
    const wide = state.view === 'expanded' || state.mode === 'settings';
    const want = wide ? c.expandedWidth || 580 : c.width || 440;
    state.panelW = Math.max(300, Math.min(want, (state.layout.maxWidth || 1600) - 20));
    document.documentElement.style.setProperty('--panel-w', `${state.panelW}px`);
    reportSize();
  }

  let sizeQueued = false;
  function reportSize() {
    if (sizeQueued) return;
    sizeQueued = true;
    requestAnimationFrame(() => {
      sizeQueued = false;
      const h = panel.getBoundingClientRect().height;
      api.resize(state.panelW + 20, Math.ceil(h) + 20);
    });
  }
  new ResizeObserver(reportSize).observe(panel);

  function setMode(mode, { search = true } = {}) {
    if (mode === 'settings' && state.mode !== 'settings') state.modeBeforeSettings = state.mode;
    if (state.mode === 'settings' && mode !== 'settings') {
      applyLayout(); // toglie l'anteprima dell'opacità non salvata
      if (mode === 'notes' && state.modeBeforeSettings === 'notes') search = false; // la nota aperta resta
    }
    if (state.mode in state.drafts) state.drafts[state.mode] = input.value;
    if (mode in state.drafts && mode !== state.mode) {
      input.value = state.drafts[mode];
      autoGrow();
    }
    state.mode = mode;
    panel.classList.remove('mode-chat', 'mode-notes', 'mode-settings');
    panel.classList.add(`mode-${mode}`);
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.mode === mode;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    input.placeholder = mode === 'notes' ? 'Cerca nelle note…' : 'Chiedi a Claude…';
    input.title =
      mode === 'notes'
        ? 'Invio apre la nota selezionata · ↑↓ per scegliere'
        : 'Invio per inviare · Shift+Invio per andare a capo · "/nota testo" salva un appunto in Obsidian';
    if (mode === 'settings') {
      stopCountdown();
      fillSettings();
    } else if (mode === 'notes') {
      if (search) refreshNotes(0);
    } else if (mode === 'chat') {
      setView(chatLog.children.length && state.view !== 'compact' ? state.view : 'compact');
    }
    updateWidth();
    updateStatus();
    updateSendState();
    reportState();
  }

  function setView(view) {
    state.view = view;
    panel.classList.remove('view-compact', 'view-preview', 'view-expanded');
    panel.classList.add(`view-${view}`);
    $('btn-expand').classList.toggle('on', view === 'expanded');
    updateOlder();
    updateWidth();
  }

  function toggleExpand() {
    if (state.mode === 'settings') return;
    if (state.view === 'expanded') {
      setView(state.mode === 'chat' && !chatLog.children.length ? 'compact' : 'preview');
    } else {
      setView('expanded');
      stopCountdown(); // se espandi, vuoi leggere: niente scomparsa finché non esci
    }
  }

  function updateStatus() {
    const c = state.config;
    let s = '';
    if (state.streaming) s = 'Claude sta scrivendo…';
    else if (state.mode === 'chat') s = chatLabel(c);
    else if (state.mode === 'notes') s = c.vaultName ? c.vaultName : 'Nessun vault impostato';
    if (state.ghost) s = 'Fantasma · i clic passano sotto';
    statusEl.textContent = s;
    statusEl.title =
      state.mode === 'chat'
        ? `${c.backend === 'api' ? 'Chiave API' : 'Abbonamento tramite Claude Code'} · ragionamento: ${EFFORT_NAMES[c.effort] || c.effort}`
        : s;
  }

  function chatLabel(c) {
    if (c.backend === 'api') return `${MODEL_NAMES[c.model] || c.model} · API`;
    return c.ccModel && c.ccModel !== 'default' ? `Abbonamento · ${MODEL_NAMES[c.ccModel] || c.ccModel}` : 'Abbonamento';
  }

  function reportState() {
    api.reportState({ mode: state.mode, pinned: state.pinned });
  }

  // ------------------------------------------------------ mostra/nascondi

  api.on('overlay:show', ({ mode, ...layout }) => {
    state.layout = { ...state.layout, ...layout };
    applyLayout();
    const wasVisible = state.visible;
    state.visible = true;
    if (mode !== state.mode || !wasVisible) setMode(mode);
    if (mode === 'chat' && !wasVisible) setView('compact');
    // Chat già fissata: puoi tornare al tuo programma con un clic, il pop-up resta lì.
    if (!wasVisible && mode === 'chat' && state.config.openPinned) {
      setPinned(true, { silent: true });
      state.autoPinned = true;
    }
    if (!wasVisible) {
      panel.classList.add('is-hidden');
      requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('is-hidden')));
    }
    if (mode !== 'settings') {
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    }
    const failed = state.config.hotkeyFailures || [];
    if (failed.length && !state.warnedHotkeys) {
      state.warnedHotkeys = true;
      setTimeout(() => toast(`Scorciatoie non registrate: ${failed.join(', ')} (cambiale in ⚙)`, true), 400);
    }
  });

  api.on('overlay:request-hide', () => requestHide());

  function requestHide() {
    if (!state.visible) return;
    if (state.streaming) api.chatAbort();
    stopCountdown();
    panel.classList.add('is-hidden');
    state.visible = false;
    setTimeout(() => {
      api.hide();
      resetAfterHide();
    }, 170);
  }

  function resetAfterHide() {
    setPinned(false, { silent: true });
    setGhostClass(false);
    if (state.mode === 'settings') setMode(state.modeBeforeSettings);
    closeNote();
    setView('compact');
  }

  window.addEventListener('blur', () => {
    if (!state.visible || state.pinned || state.mode === 'settings') return;
    if (Date.now() < state.holdUntil || state.streaming) return;
    const empty = state.view === 'compact' && !input.value.trim();
    if (empty) requestHide();
    else if (!timer.active) startCountdown(hideSeconds());
  });

  function hideSeconds() {
    return state.mode === 'notes' && state.notes.current
      ? state.config.noteDisplaySeconds || 15
      : state.config.autoHideSeconds || 12;
  }

  // ------------------------------------------------------ fissa / fantasma

  function setPinned(on, { silent = false } = {}) {
    state.pinned = Boolean(on);
    state.autoPinned = false; // da qui in poi la puntina è una scelta dell'utente
    panel.classList.toggle('pinned', state.pinned);
    $('btn-pin').classList.toggle('on', state.pinned);
    $('btn-pin').title = state.pinned
      ? 'Fissato: togli la puntina per farlo sparire'
      : 'Fissa: non scompare finché non togli la puntina';
    reportState();
    if (silent) return;
    if (state.pinned) {
      stopCountdown();
    } else {
      if (state.ghost) api.setGhost(false);
      requestHide(); // togliere la puntina chiude il pop-up
    }
  }

  function setGhostClass(on) {
    state.ghost = Boolean(on);
    state.interactive = state.ghost ? false : null;
    panel.classList.toggle('ghost', state.ghost);
    panel.classList.remove('ghost-peek');
    document.querySelectorAll('.ghost-toggle').forEach((b) => b.classList.toggle('on', state.ghost));
    updateStatus();
  }

  api.on('overlay:ghost', (on) => {
    peek.ctrlFromMain = false;
    peek.ctrlFromEvent = false;
    peek.overToggle = false;
    setGhostClass(on);
    if (on) {
      setPinned(true, { silent: true });
      stopCountdown();
    }
  });

  // In modalità fantasma la finestra ignora i clic, ma riceve ancora il movimento del
  // mouse: tenendo premuto Ctrl (o passando su un pulsante 👻) torna cliccabile.
  // Cliccabile se: Ctrl premuto (da main su Windows, o dall'evento del mouse altrove)
  // oppure il mouse è sopra un pulsante 👻.
  const peek = { ctrlFromMain: false, ctrlFromEvent: false, overToggle: false };
  function setInteractive(on) {
    if (!state.ghost || state.interactive === on) return;
    state.interactive = on;
    api.setIgnoreMouse(!on);
    panel.classList.toggle('ghost-peek', on);
  }
  const updatePeek = () => setInteractive(peek.ctrlFromMain || peek.ctrlFromEvent || peek.overToggle);
  api.on('overlay:peek', (down) => {
    peek.ctrlFromMain = Boolean(down);
    updatePeek();
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.ghost) return;
    peek.overToggle = Boolean(e.target && e.target.closest && e.target.closest('.ghost-toggle'));
    peek.ctrlFromEvent = e.ctrlKey;
    updatePeek();
  });
  document.documentElement.addEventListener('mouseleave', () => {
    peek.overToggle = false;
    peek.ctrlFromEvent = false;
    updatePeek();
  });
  // Ctrl + rotellina scorre la nota invece di ingrandire la pagina.
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      content.scrollTop += e.deltaY;
    },
    { passive: false }
  );

  // ------------------------------------------------------------- timer

  const timer = { active: false, running: false, remaining: 0, total: 0, startedAt: 0, handle: 0 };

  function startCountdown(seconds) {
    stopCountdown();
    if (state.pinned || state.ghost || !state.visible) return;
    timer.total = seconds * 1000;
    timer.remaining = timer.total;
    timer.active = true;
    timerEl.classList.add('active');
    resumeCountdown();
  }

  function resumeCountdown() {
    if (!timer.active || timer.running || state.hovering) return;
    timer.running = true;
    timer.startedAt = performance.now();
    timerFill.style.transition = 'none';
    timerFill.style.width = `${(timer.remaining / timer.total) * 100}%`;
    void timerFill.offsetWidth; // forza il reflow prima della transizione
    timerFill.style.transition = `width ${timer.remaining}ms linear`;
    timerFill.style.width = '0%';
    timer.handle = setTimeout(() => {
      timer.running = false;
      timer.active = false;
      requestHide();
    }, timer.remaining);
  }

  function pauseCountdown() {
    if (!timer.running) return;
    clearTimeout(timer.handle);
    timer.running = false;
    timer.remaining = Math.max(800, timer.remaining - (performance.now() - timer.startedAt));
    timerFill.style.transition = 'none';
    timerFill.style.width = `${(timer.remaining / timer.total) * 100}%`;
  }

  function stopCountdown() {
    clearTimeout(timer.handle);
    timer.active = false;
    timer.running = false;
    timerEl.classList.remove('active');
    timerFill.style.transition = 'none';
    timerFill.style.width = '0%';
  }

  panel.addEventListener('mouseenter', () => {
    state.hovering = true;
    pauseCountdown();
  });
  panel.addEventListener('mouseleave', () => {
    state.hovering = false;
    resumeCountdown();
  });

  // -------------------------------------------------------------- chat

  function updateSendState() {
    sendBtn.disabled = !state.streaming && !input.value.trim();
    sendBtn.title = state.streaming ? 'Interrompi (Esc)' : 'Invia (Invio)';
  }

  function setStreaming(on) {
    state.streaming = on;
    panel.classList.toggle('streaming', on);
    updateSendState();
    updateStatus();
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function icon(id) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ico');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  function addTurn(text, ctx, attachments = []) {
    const turn = el('div', 'turn');
    const user = el('div', 'msg-user');
    if (attachments.length) {
      const thumbs = el('div', 'thumbs');
      for (const a of attachments) {
        const img = el('img');
        img.src = a.thumb;
        img.alt = 'immagine allegata';
        thumbs.append(img);
      }
      user.append(thumbs);
    }
    if (ctx) {
      const att = el('div', 'attached');
      att.append(icon('i-clip'), document.createTextNode(ctx.title));
      user.append(att);
    }
    user.append(document.createTextNode(text));
    const answer = el('div', 'msg-assistant md');
    const thinking = el('div', 'thinking');
    const dots = el('span', 'dots');
    dots.append(el('i'), el('i'), el('i'));
    thinking.append(dots, el('span', 'label', 'Claude sta pensando…'));
    answer.append(thinking);
    turn.append(user, answer);
    chatLog.append(turn);
    updateOlder();
    return turn;
  }

  function updateOlder() {
    const n = chatLog.children.length - 1;
    const show = state.mode === 'chat' && state.view === 'preview' && n > 0;
    olderBtn.hidden = !show;
    if (show) olderBtn.textContent = `↑ ${n} ${n === 1 ? 'scambio precedente' : 'scambi precedenti'} — espandi`;
  }

  let streamRaf = 0;
  let streamPending = null;
  function scheduleRender(target, text, turn) {
    streamPending = { target, text, turn };
    if (streamRaf) return;
    streamRaf = setTimeout(() => {
      streamRaf = 0;
      const p = streamPending;
      if (!p) return;
      const follow = content.scrollHeight - content.scrollTop - content.clientHeight < 48;
      p.target.innerHTML = Markdown.render(p.text);
      keepInView(p.turn, follow);
    }, 120);
  }

  // In anteprima resta visibile l'inizio della risposta; espanso segue il testo.
  function keepInView(turn, follow) {
    if (state.view === 'expanded') {
      if (follow) content.scrollTop = content.scrollHeight;
    } else if (turn) {
      content.scrollTop = Math.max(0, turn.offsetTop - 6);
    }
  }

  async function sendChat() {
    if (state.streaming) {
      api.chatAbort();
      return;
    }
    const text = input.value.trim();
    if (!text) return;

    if (/^\/nota(\s|$)/i.test(text)) {
      // Appunto senza risposta in chat: passa dallo stesso flusso di archiviazione.
      const body = text.replace(/^\/nota\s*/i, '');
      if (!body) return toast('Scrivi il testo dopo /nota', true);
      const images = state.attachments.map((a) => ({ data: a.full, mediaType: 'image/png' }));
      input.value = '';
      autoGrow();
      clearAttachments();
      updateSendState();
      toast('Archivio l’appunto…');
      const r = await api.archive({ question: '', answer: body, images, kind: 'nota' });
      if (!r.ok || (!r.items.length && !r.rough)) {
        // Non salvato (vault mancante, errore, "niente da archiviare"): rimetto il testo nel campo.
        if (!input.value.trim()) {
          input.value = text;
          autoGrow();
          updateSendState();
        }
      }
      return toast(archiveSummary(r), !r.ok);
    }

    input.value = '';
    autoGrow();
    stopCountdown();
    const ctx = state.context;
    setContext(null);
    const attachments = state.attachments;
    clearAttachments();
    const turn = addTurn(text, ctx, attachments);
    const answer = turn.querySelector('.msg-assistant');
    setView(state.view === 'expanded' ? 'expanded' : 'preview');
    keepInView(turn, true);
    setStreaming(true);

    let acc = '';
    const off = api.on('chat:delta', (delta) => {
      acc += delta;
      scheduleRender(answer, acc, turn);
    });
    const offStatus = api.on('chat:status', (msg) => {
      const label = answer.querySelector('.thinking .label');
      if (label) label.textContent = msg;
      else statusEl.textContent = msg;
    });
    const res = await api.chatSend(
      text,
      ctx && ctx.rel,
      attachments.map((a) => a.model)
    );
    off();
    offStatus();
    if (streamRaf) clearTimeout(streamRaf);
    streamRaf = 0;
    streamPending = null;
    setStreaming(false);

    if (res.ok) {
      const full = res.text || acc;
      answer.innerHTML = Markdown.render(full);
      if (res.stopReason === 'max_tokens') answer.append(el('div', 'interrupted', 'Risposta troncata per lunghezza.'));
      if (res.usedNotes && res.usedNotes.length) turn.append(usedNotesLine(res.usedNotes));
      const job = {
        question: text,
        answer: full,
        previous: state.lastExchange,
        images: attachments.map((a) => ({ data: a.full, mediaType: 'image/png' })),
        kind: 'chat',
      };
      state.lastExchange = { question: text, answer: full.slice(0, 1500) };
      addActions(turn, job);
      if (state.config.autoArchive) runArchive(turn, job);
    } else if (res.aborted) {
      answer.innerHTML = acc ? Markdown.render(acc) : '';
      answer.append(el('div', 'interrupted', 'Risposta interrotta (non entra nella conversazione).'));
    } else {
      answer.classList.add('error');
      answer.textContent = res.error || 'Errore sconosciuto.';
      if (/impostazioni/i.test(res.error || '')) {
        const b = el('button', 'chip-btn', 'Apri impostazioni');
        b.addEventListener('click', () => setMode('settings'));
        const wrap = el('div', 'msg-actions');
        wrap.append(b);
        turn.append(wrap);
      }
    }
    keepInView(turn, true);
    reportSize();
    if (state.visible && !state.pinned && !input.value.trim()) startCountdown(state.config.autoHideSeconds || 12);
  }

  function addActions(turn, job) {
    const answer = job.answer;
    const wrap = el('div', 'msg-actions');
    const copy = el('button', 'chip-btn');
    copy.append(icon('i-copy'), document.createTextNode('Copia'));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(answer);
        toast('Copiato negli appunti');
      } catch {
        toast('Copia non riuscita', true);
      }
    });
    wrap.append(copy);
    if (!state.config.autoArchive) {
      // Archiviazione automatica spenta: lo stesso flusso parte da questo pulsante.
      const save = el('button', 'chip-btn');
      save.append(icon('i-inbox'), document.createTextNode('Salva in Obsidian'));
      save.addEventListener('click', () => {
        save.remove();
        runArchive(turn, job);
      });
      wrap.append(save);
    }
    turn.append(wrap);
  }

  // ------------------------------------------------------- archiviazione

  function usedNotesLine(notes) {
    const line = el('div', 'used-notes', '📚 Dalle tue note: ');
    notes.forEach((n, i) => {
      if (i) line.append(document.createTextNode(' · '));
      const a = el('a', '', n.title);
      a.dataset.rel = n.rel;
      line.append(a);
    });
    return line;
  }

  async function runArchive(turn, job) {
    const box = el('div', 'archive-box');
    const pending = el('div', 'archive-line pending', '📁 Archivio nel vault…');
    box.append(pending);
    turn.append(box);
    reportSize();
    const r = await api.archive(job);
    job.images = []; // le immagini sono salvate: non tenerle in memoria per tutta la chat
    box.textContent = '';
    renderArchive(box, r);
    reportSize();
  }

  function renderArchive(box, r) {
    if (!r.ok) {
      box.append(el('div', 'archive-line error', `📁 ⚠️ ${r.error || 'Archiviazione non riuscita.'}`));
      return;
    }
    if (r.skipped && !r.items.length && !r.rough) {
      box.append(el('div', 'archive-line pending', '📁 Niente da archiviare'));
      return;
    }
    for (const it of r.items) {
      const line = el('div', 'archive-line');
      const crumbs = el('span', 'crumbs', `📁 ${it.materia} › ${it.categoria} › `);
      const a = el('a', '', it.titolo);
      a.dataset.rel = it.rel;
      crumbs.append(a);
      line.append(crumbs, el('span', 'state', `(${it.action})`));
      box.append(line);
    }
    if (r.rough) {
      const line = el('div', 'archive-line warn', '📁 Da sistemare in ');
      const a = el('a', '', r.roughRel ? r.roughRel.replace(/\.md$/, '') : '1 - Rough Notes');
      if (r.roughRel) a.dataset.rel = r.roughRel;
      line.append(a);
      if (r.reason) line.title = r.reason;
      box.append(line);
    }
    if (r.opId) {
      const undo = el('button', 'chip-btn');
      undo.append(icon('i-undo'), document.createTextNode('Annulla'));
      undo.title = 'Ripristina il vault com’era prima di questa archiviazione';
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        const u = await api.archiveUndo(r.opId);
        box.textContent = '';
        if (!u.ok) {
          box.append(el('div', 'archive-line error', `↩ ${u.error}`));
        } else {
          const msg = u.skipped && u.skipped.length
            ? `↩ Annullata, tranne ${u.skipped.length} file modificati nel frattempo`
            : '↩ Archiviazione annullata';
          box.append(el('div', 'archive-line pending', msg));
        }
        reportSize();
      });
      (box.lastElementChild || box).append(undo);
    }
  }

  function archiveSummary(r) {
    if (!r.ok) return r.error || 'Archiviazione non riuscita.';
    if (r.items.length) {
      const it = r.items[0];
      const more = r.items.length > 1 ? ` (+${r.items.length - 1})` : '';
      return `Salvato in ${it.materia} → ${it.categoria} → ${it.titolo}${more}`;
    }
    if (r.rough) return 'Salvato in Rough Notes, sotto «Da sistemare»';
    return 'Niente da archiviare';
  }

  async function openNoteRel(rel) {
    if (state.mode !== 'notes') setMode('notes', { search: false });
    await openNote(rel);
  }

  // -------------------------------------------------------------- allegati

  async function addImageBlob(blob) {
    if (!blob || !/^image\//.test(blob.type)) return;
    try {
      const bitmap = await createImageBitmap(blob);
      const encode = (w, h, type, quality) => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
        return c.toDataURL(type, quality);
      };
      // Originale in PNG per il vault; copia ridotta (max 1568 px) per Claude.
      const full = encode(bitmap.width, bitmap.height, 'image/png').split(',')[1];
      const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
      let modelUrl = encode(bitmap.width * scale, bitmap.height * scale, 'image/png');
      let mediaType = 'image/png';
      if (modelUrl.length > 4.5 * 1024 * 1024) {
        modelUrl = encode(bitmap.width * scale, bitmap.height * scale, 'image/jpeg', 0.9);
        mediaType = 'image/jpeg';
      }
      const thumbScale = Math.min(1, 120 / Math.max(bitmap.width, bitmap.height));
      const thumb = encode(bitmap.width * thumbScale, bitmap.height * thumbScale, 'image/png');
      state.attachments.push({ full, model: { data: modelUrl.split(',')[1], mediaType }, thumb });
      renderAttachments();
    } catch {
      toast('Immagine non leggibile', true);
    }
  }

  function renderAttachments() {
    const box = $('attachments');
    box.textContent = '';
    state.attachments.forEach((a, i) => {
      const item = el('div', 'att');
      const img = el('img');
      img.src = a.thumb;
      img.alt = `immagine ${i + 1}`;
      const rm = el('button');
      rm.type = 'button';
      rm.title = 'Togli immagine';
      rm.append(icon('i-x'));
      rm.addEventListener('click', () => {
        state.attachments.splice(i, 1);
        renderAttachments();
      });
      item.append(img, rm);
      box.append(item);
    });
    box.hidden = !state.attachments.length;
    reportSize();
  }

  function clearAttachments() {
    state.attachments = [];
    renderAttachments();
  }

  document.addEventListener('paste', (e) => {
    if (state.mode !== 'chat') return;
    const files = [...(e.clipboardData ? e.clipboardData.items : [])]
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    files.forEach(addImageBlob);
  });
  panel.addEventListener('dragover', (e) => {
    if (state.mode !== 'chat') return;
    e.preventDefault();
    panel.classList.add('drop-target');
  });
  panel.addEventListener('dragleave', () => panel.classList.remove('drop-target'));
  panel.addEventListener('drop', (e) => {
    panel.classList.remove('drop-target');
    if (state.mode !== 'chat') return;
    e.preventDefault();
    [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')).forEach(addImageBlob);
  });

  function newChat() {
    api.chatReset();
    state.lastExchange = null;
    chatLog.textContent = '';
    setContext(null);
    setStreaming(false);
    stopCountdown();
    setView('compact');
    input.focus();
  }

  function setContext(ctx) {
    state.context = ctx;
    $('context-chip').hidden = !ctx;
    $('context-label').textContent = ctx ? `Nota allegata: ${ctx.title}` : '';
  }

  // -------------------------------------------------------------- note

  let searchTimer = 0;
  let searchSeq = 0;

  function refreshNotes(delay = 130) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, delay);
  }

  async function runSearch() {
    searchTimer = 0;
    const q = input.value.trim();
    const seq = ++searchSeq;
    const r = await api.notesSearch(q);
    if (seq !== searchSeq || state.mode !== 'notes') return;
    closeNote();
    results.textContent = '';
    if (!r.ok) {
      const box = el('div', 'empty', r.error);
      const b = el('button', 'chip-btn', 'Imposta il vault');
      b.addEventListener('click', () => setMode('settings'));
      box.append(el('br'), b);
      results.append(box);
    } else {
      state.notes.results = r.results;
      state.notes.selected = 0;
      if (!q && r.results.length) results.append(el('div', 'section-label', 'Modificate di recente'));
      if (!r.results.length) results.append(el('div', 'empty', q ? `Nessuna nota trovata per “${q}”.` : 'Il vault è vuoto.'));
      r.results.forEach((n, i) => {
        const b = el('button', 'result');
        b.dataset.rel = n.rel;
        b.dataset.index = String(i);
        b.setAttribute('role', 'option');
        const title = el('div', 'result-title');
        title.append(el('span', '', n.title));
        if (n.folder) title.append(el('span', 'result-folder', n.folder));
        b.append(title);
        if (n.snippet) b.append(el('div', 'result-snippet', n.snippet));
        results.append(b);
      });
      highlightSelected();
    }
    setView(state.view === 'expanded' ? 'expanded' : 'preview');
    content.scrollTop = 0;
  }

  function highlightSelected() {
    results.querySelectorAll('.result').forEach((b) => {
      const on = Number(b.dataset.index) === state.notes.selected;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest' });
    });
  }

  function moveSelection(delta) {
    const n = state.notes.results.length;
    if (!n || !noteView.hidden) return;
    state.notes.selected = (state.notes.selected + delta + n) % n;
    highlightSelected();
  }

  async function openNote(rel) {
    const r = await api.notesRead(rel);
    if (!r.ok) return toast(r.error, true);
    state.notes.current = r.note;
    $('note-title').textContent = r.note.title;
    $('note-folder').textContent = r.note.folder || 'radice del vault';
    noteBody.innerHTML = Markdown.render(r.note.text);
    loadEmbeds(noteBody);
    results.hidden = true;
    noteView.hidden = false;
    setView(state.view === 'expanded' ? 'expanded' : 'preview');
    content.scrollTop = 0;
    // La nota resta per qualche secondo; con la puntina (o in fantasma) resta finché vuoi.
    if (state.autoPinned) setPinned(false, { silent: true }); // le note restano temporanee anche dalla chat fissata
    if (state.config.notesOpenGhost && !state.ghost) api.setGhost(true);
    else if (!state.pinned) startCountdown(state.config.noteDisplaySeconds || 15);
  }

  $('note-ghost').addEventListener('click', () => api.setGhost(!state.ghost));

  // Le immagini ![[...]] della nota, lette dal vault tramite il processo principale.
  function loadEmbeds(root) {
    root.querySelectorAll('.embed-img').forEach(async (span) => {
      const r = await api.notesImage(span.dataset.embed);
      if (!r.ok || !span.isConnected) return;
      const img = el('img', 'embed');
      img.src = r.url;
      img.alt = span.dataset.embed;
      img.addEventListener('load', reportSize);
      span.replaceWith(img);
    });
  }

  function closeNote() {
    noteView.hidden = true;
    results.hidden = false;
    state.notes.current = null;
  }

  results.addEventListener('click', (e) => {
    const b = e.target.closest('.result');
    if (b) openNote(b.dataset.rel);
  });

  $('note-back').addEventListener('click', () => {
    closeNote();
    stopCountdown();
    input.focus();
  });
  $('note-open').addEventListener('click', () => {
    if (state.notes.current) api.openInObsidian(state.notes.current.rel);
  });
  $('note-ask').addEventListener('click', () => {
    const n = state.notes.current;
    if (!n) return;
    stopCountdown();
    setContext({ rel: n.rel, title: n.title });
    setMode('chat');
    setView(chatLog.children.length ? 'preview' : 'compact');
    input.value = '';
    autoGrow();
    input.focus();
  });

  // Link nelle risposte e nelle note; clic sul contenuto in anteprima = espandi.
  content.addEventListener('click', async (e) => {
    const a = e.target.closest('a');
    if (a) {
      e.preventDefault();
      if (a.dataset.rel) {
        openNoteRel(a.dataset.rel);
      } else if (a.classList.contains('wikilink')) {
        const r = await api.notesResolve(a.dataset.link);
        if (r.ok && r.rel) {
          if (state.mode !== 'notes') setMode('notes', { search: false });
          openNote(r.rel);
        } else {
          toast(r.error || `Nota “${a.dataset.link}” non trovata`, true);
        }
      } else if (a.dataset.href) {
        api.openExternal(a.dataset.href);
      }
      return;
    }
    if (state.mode === 'settings') return;
    if (e.target.closest('button, input, select, textarea, label')) return;
    if (state.view === 'preview' && !String(window.getSelection())) toggleExpand();
  });

  olderBtn.addEventListener('click', () => toggleExpand());

  // ------------------------------------------------------- impostazioni

  function fillSettings() {
    const c = state.config;
    for (const elx of form.elements) {
      if (!elx.name || elx.name === 'apiKey') continue;
      if (elx.type === 'checkbox') elx.checked = Boolean(c[elx.name]);
      else if (elx.classList.contains('hotkey')) setHotkeyField(elx, c[elx.name] || '');
      else if (c[elx.name] !== undefined) elx.value = c[elx.name];
    }
    form.elements.apiKey.value = '';
    setBackendClass(c.backend);
    if (c.backend !== 'api') refreshCcStatus();
    $('apikey-state').textContent = c.hasApiKey
      ? 'Chiave salvata (cifrata su questo PC). Lascia vuoto per non cambiarla.'
      : c.apiKeyFromEnv
        ? 'In uso la variabile ANTHROPIC_API_KEY. Puoi comunque salvarne una qui.'
        : 'Nessuna chiave: creala nella Console Anthropic (platform.claude.com).';
    $('opacity-out').textContent = `${Math.round((c.opacity ?? 0.86) * 100)}%`;
    $('ghost-out').textContent = `${Math.round((c.ghostOpacity ?? 0.7) * 100)}%`;
    $('settings-msg').textContent = '';
    $('settings-msg').classList.remove('error');
    content.scrollTop = 0;
  }

  function setBackendClass(backend) {
    form.classList.toggle('backend-api', backend === 'api');
    form.classList.toggle('backend-subscription', backend !== 'api');
  }

  let ccSeq = 0;
  async function refreshCcStatus() {
    const box = $('cc-status');
    const seq = ++ccSeq;
    box.className = 'cc-status';
    box.textContent = 'Cerco Claude Code…';
    const r = await api.checkClaudeCode(form.elements.claudePath.value.trim());
    if (seq !== ccSeq) return;
    box.textContent = '';
    const strong = (t) => el('strong', '', t);
    const code = (t) => el('code', '', t);
    if (r.ok) {
      box.classList.add('ok');
      box.append(
        strong(`✓ Claude Code trovato (${r.version}).`),
        document.createTextNode(
          "\nUsa l'account con cui hai fatto l'accesso a Claude Code: con un piano Pro o Max consumi il tuo abbonamento, senza costi extra. " +
            'Se le risposte danno errore di accesso, apri un terminale ed esegui '
        ),
        code('claude'),
        document.createTextNode(' una volta per fare il login.')
      );
    } else {
      box.classList.add('bad');
      box.append(
        strong(`✗ ${r.error}`),
        document.createTextNode('\nInstallalo da PowerShell con '),
        code('irm https://claude.ai/install.ps1 | iex'),
        document.createTextNode(', poi esegui '),
        code('claude'),
        document.createTextNode(' e accedi con il tuo account Claude. Infine premi «Verifica».')
      );
    }
  }

  $('cc-check').addEventListener('click', () => refreshCcStatus());
  form.elements.backend.addEventListener('change', () => {
    setBackendClass(form.elements.backend.value);
    if (form.elements.backend.value !== 'api') refreshCcStatus();
  });

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'opacity') {
      $('opacity-out').textContent = `${Math.round(t.value * 100)}%`;
      document.documentElement.style.setProperty('--alpha', t.value); // anteprima dal vivo
    }
    if (t.name === 'ghostOpacity') $('ghost-out').textContent = `${Math.round(t.value * 100)}%`;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    for (const elx of form.elements) {
      if (!elx.name || elx.name === 'apiKey') continue;
      patch[elx.name] = elx.type === 'checkbox' ? elx.checked : elx.classList.contains('hotkey') ? elx.dataset.accel || '' : elx.value;
    }
    const key = form.elements.apiKey.value.trim();
    const backendBefore = state.config.backend;
    const res = await api.saveConfig(patch, key ? key : undefined);
    if (!res.ok) {
      $('settings-msg').textContent = res.error;
      $('settings-msg').classList.add('error');
      return;
    }
    state.config = res.config;
    if (res.config.backend !== backendBefore) newChat(); // conversazione nuova con il nuovo collegamento
    applyLayout();
    if (res.failedHotkeys && res.failedHotkeys.length) {
      $('settings-msg').textContent = `Scorciatoie non disponibili: ${res.failedHotkeys.join(', ')}`;
      $('settings-msg').classList.add('error');
      fillSettingsKeepMsg();
      return;
    }
    toast('Impostazioni salvate');
    setMode(state.modeBeforeSettings);
    input.focus();
  });

  function fillSettingsKeepMsg() {
    const msg = $('settings-msg').textContent;
    fillSettings();
    $('settings-msg').textContent = msg;
    $('settings-msg').classList.add('error');
  }

  $('settings-cancel').addEventListener('click', () => {
    applyLayout(); // annulla l'anteprima dell'opacità
    setMode(state.modeBeforeSettings);
    input.focus();
  });

  $('pick-vault').addEventListener('click', async () => {
    state.holdUntil = Date.now() + 10 * 60 * 1000;
    const dir = await api.pickVault();
    state.holdUntil = 0;
    if (dir) form.elements.vaultPath.value = dir;
  });

  // Cattura delle scorciatoie: clicca il campo e premi la combinazione.
  form.querySelectorAll('.hotkey').forEach((field) => {
    field.addEventListener('focus', () => field.classList.add('capturing'));
    field.addEventListener('blur', () => field.classList.remove('capturing'));
    field.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        if (e.key === 'Backspace' || e.key === 'Delete') setHotkeyField(field, '');
        if (e.key === 'Escape' || e.key === 'Tab' || e.key === 'Backspace' || e.key === 'Delete') field.blur();
        return;
      }
      const acc = accelerator(e);
      if (acc) {
        setHotkeyField(field, acc);
        field.blur();
      }
    });
  });

  function setHotkeyField(field, accel) {
    field.dataset.accel = accel;
    field.value = accel.replace('CommandOrControl', 'Ctrl').replace('Space', 'Spazio');
    field.title = field.value;
  }

  function accelerator(e) {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
    const mods = [];
    if (e.ctrlKey) mods.push('CommandOrControl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    let k = e.code;
    if (/^Key[A-Z]$/.test(k)) k = k.slice(3);
    else if (/^Digit\d$/.test(k)) k = k.slice(5);
    else if (/^Numpad\d$/.test(k)) k = `num${k.slice(6)}`;
    else if (/^Arrow/.test(k)) k = k.slice(5);
    else if (/^F\d{1,2}$/.test(k)) k = k.toUpperCase();
    else {
      const map = {
        Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
        Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Period: '.', Comma: ',', Minus: '-',
        Equal: '=', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
        Backquote: '`',
      };
      k = map[k];
    }
    return k ? [...mods, k].join('+') : null;
  }

  api.on('config:changed', ({ config, layout }) => {
    const a = config.customAnchor;
    const b = state.config.customAnchor;
    if (a && (!b || a.x !== b.x || a.y !== b.y)) toast('Posizione salvata');
    state.config = config;
    state.layout = { ...state.layout, ...layout };
    applyLayout();
    updateStatus();
  });

  // ------------------------------------------------------------- input

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  input.addEventListener('input', () => {
    autoGrow();
    updateSendState();
    if (state.mode === 'notes') refreshNotes();
    if (input.value.trim()) stopCountdown(); // stai scrivendo: niente scomparsa
    if (Date.now() < state.holdUntil) state.holdUntil = Date.now() + 15000; // dettatura in corso
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (state.mode === 'chat') sendChat();
      else if (state.mode === 'notes') {
        const openSelected = () => {
          const n = state.notes.results[state.notes.selected];
          if (noteView.hidden && n) openNote(n.rel);
        };
        if (searchTimer) {
          clearTimeout(searchTimer);
          searchTimer = 0;
          runSearch().then(openSelected);
        } else {
          openSelected();
        }
      }
    } else if (state.mode === 'notes' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.activeElement && document.activeElement.classList.contains('hotkey')) return;
    e.preventDefault();
    if (state.streaming) return api.chatAbort();
    if (state.mode === 'settings') {
      applyLayout();
      return setMode(state.modeBeforeSettings);
    }
    if (state.mode === 'notes' && !noteView.hidden) {
      closeNote();
      stopCountdown();
      return;
    }
    if (state.view === 'expanded') return setView(state.mode === 'chat' && !chatLog.children.length ? 'compact' : 'preview');
    requestHide();
  });

  sendBtn.addEventListener('click', () => sendChat());

  micBtn.addEventListener('click', async () => {
    input.focus();
    state.holdUntil = Date.now() + 20000;
    const r = await api.dictate();
    if (!r.ok) {
      state.holdUntil = 0;
      return toast(r.error, true);
    }
    micBtn.classList.add('listening');
    toast('Parla pure: il testo compare nel campo');
    setTimeout(() => micBtn.classList.remove('listening'), 6000);
  });

  $('context-clear').addEventListener('click', () => setContext(null));

  // -------------------------------------------------------------- barra

  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      if (t.dataset.mode !== state.mode) setMode(t.dataset.mode);
      input.focus();
    })
  );
  // Il pop-up si trascina dalla barra in alto con il trascinamento nativo di Windows
  // (vedi .bar in style.css); "Rimetti nell'angolo" sta nelle impostazioni e nel menu dell'icona.
  $('reset-position').addEventListener('click', () => {
    api.resetPosition();
    toast('Pop-up rimesso nell’angolo');
  });

  $('btn-new').addEventListener('click', newChat);
  $('btn-expand').addEventListener('click', toggleExpand);
  $('btn-ghost').addEventListener('click', () => api.setGhost(!state.ghost));
  $('btn-pin').addEventListener('click', () => setPinned(!state.pinned));
  $('btn-settings').addEventListener('click', () =>
    state.mode === 'settings' ? setMode(state.modeBeforeSettings) : setMode('settings')
  );
  $('btn-close').addEventListener('click', () => requestHide());

  let toastTimer = 0;
  function toast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------- avvio

  (async () => {
    const { config, layout } = await api.getConfig();
    state.config = config;
    state.layout = { ...state.layout, ...layout };
    applyLayout();
    setMode('chat');
    setView('compact');
    autoGrow();
  })();
})();
