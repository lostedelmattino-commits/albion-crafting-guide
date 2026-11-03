'use strict';
// Processo principale: finestra overlay trasparente sempre in primo piano,
// scorciatoie globali, icona nella barra di sistema e ponte IPC verso Claude/Obsidian.

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  shell,
  dialog,
} = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const { ClaudeChat } = require('./claude');
const { ClaudeCodeChat, checkClaudeCode } = require('./claude-code');
const { Vault } = require('./obsidian');
const { OneShot } = require('./llm');
const { Archivist, DIRS } = require('./archive');

const CORNERS = [
  ['bottom-right', 'In basso a destra'],
  ['bottom-left', 'In basso a sinistra'],
  ['top-right', 'In alto a destra'],
  ['top-left', 'In alto a sinistra'],
];

// Stessa cartella dati sia avviando con `npm start` sia dall'eseguibile:
// %APPDATA%\claude-overlay su Windows.
app.setPath('userData', path.join(app.getPath('appData'), 'claude-overlay'));

let win = null;
let tray = null;
let workArea = null; // area utile del monitor su cui è comparso l'overlay
let size = { w: 460, h: 120 };
let ghost = false;
let currentMode = 'chat';
let vault = null;
// Due modi di parlare con Claude: abbonamento (tramite Claude Code) oppure chiave API.
const subscriptionChat = new ClaudeCodeChat(
  () => config.get(),
  path.join(app.getPath('userData'), 'claude-code')
);
const apiChat = new ClaudeChat(
  () => config.get(),
  () => config.getApiKey()
);
const activeChat = () => (config.get().backend === 'api' ? apiChat : subscriptionChat);
// Quando Claude Code riparte con una conversazione nuova, le note di contesto vanno rimandate.
subscriptionChat.onFresh = () => sentNotes.clear();

// Archiviazione automatica nel vault (classifica con un modello veloce, scrive la nota giusta).
const archivist = new Archivist({
  getConfig: () => config.get(),
  getVault: () => vault,
  oneShot: new OneShot(
    () => config.get(),
    () => config.getApiKey(),
    path.join(app.getPath('userData'), 'claude-code', 'oneshot')
  ),
  // Fuori dal vault, così i backup non finiscono nella ricerca di Obsidian.
  backupRoot: path.join(app.getPath('appData'), 'ClaudeOverlay', 'backups'),
});
let hotkeyFailures = [];
let sendSeq = 0; // numero dell'ultima domanda inviata
let cancelledUpTo = 0; // domande fino a questo numero sono state annullate

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showOverlay('chat'));
  app.whenReady().then(start);
}

app.on('window-all-closed', () => {
  // L'app vive nella barra di sistema: non si chiude con la finestra.
});

let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  apiChat.abort();
  subscriptionChat.dispose();
  stopCtrlWatcher();
});

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('dev.claude-overlay');
  const cfg = config.get();
  vault = new Vault(cfg.vaultPath);
  createWindow();
  createTray();
  const failed = registerHotkeys();
  if (failed.length) notifyHotkeyFailure(failed);
  archivist.pruneBackups().catch(() => {});

  screen.on('display-metrics-changed', () => {
    workArea = null;
    place();
  });

  win.webContents.once('did-finish-load', async () => {
    if (await needsSetup()) {
      showOverlay('settings');
    } else if (tray && process.platform === 'win32') {
      tray.displayBalloon({
        title: 'Claude Overlay è attivo',
        content: `${pretty(cfg.hotkeyChat)} per Claude · ${pretty(cfg.hotkeyNotes)} per le note`,
      });
    }
  });
}

async function needsSetup() {
  const c = config.get();
  if (!c.vaultPath && c.autoArchive) return true; // serve il vault per archiviare
  if (c.backend === 'api') return !config.getApiKey() && !process.env.ANTHROPIC_API_KEY;
  return !(await checkClaudeCode(c.claudePath)).ok;
}

function createWindow() {
  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Claude Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false, // timer e ridimensionamenti funzionano anche da nascosto
    },
  });
  // Livello più alto possibile: resta sopra anche alle app a schermo intero in finestra.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Alt+F4 sul pop-up lo nasconde soltanto: l'app resta nell'area di notifica.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.webContents.send('overlay:request-hide');
  });

  // Nessuna navigazione dentro l'overlay: i link si aprono nel browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---------------------------------------------------------------- posizione

function currentWorkArea() {
  if (!workArea) workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return workArea;
}

// Con una posizione trascinata si usa il monitor dove è stato lasciato il pop-up,
// altrimenti quello dove si trova il mouse.
function targetWorkArea() {
  const a = config.get().customAnchor;
  if (a) return screen.getDisplayNearestPoint({ x: a.x, y: a.y }).workArea;
  return currentWorkArea();
}

function place() {
  if (!win) return;
  const c = config.get();
  const a = c.customAnchor;
  const wa = targetWorkArea();
  const m = c.margin;
  const w = Math.max(200, Math.min(size.w, wa.width - 2 * m));
  const h = Math.max(60, Math.min(size.h, wa.height - 2 * m));
  let x;
  let y;
  if (a) {
    // L'angolo "agganciato" resta fermo: la finestra si allarga verso il centro dello schermo.
    x = a.corner.endsWith('right') ? a.x - w : a.x;
    y = a.corner.startsWith('bottom') ? a.y - h : a.y;
    x = Math.min(Math.max(x, wa.x), wa.x + wa.width - w);
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - h);
  } else {
    x = c.corner.endsWith('right') ? wa.x + wa.width - w - m : wa.x + m;
    y = c.corner.startsWith('bottom') ? wa.y + wa.height - h - m : wa.y + m;
  }
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
}

/** Dopo un trascinamento: salva da quale angolo si allarga il pop-up e dove si trova. */
function saveDraggedPosition() {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const right = b.x + b.width / 2 > wa.x + wa.width / 2;
  const bottom = b.y + b.height / 2 > wa.y + wa.height / 2;
  const clampX = (x) => Math.min(Math.max(x, wa.x), wa.x + wa.width - 1);
  const clampY = (y) => Math.min(Math.max(y, wa.y), wa.y + wa.height - 1);
  config.setAnchor({
    corner: `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`,
    x: clampX(right ? b.x + b.width : b.x),
    y: clampY(bottom ? b.y + b.height : b.y),
  });
  place();
  updateTray();
  if (win) win.webContents.send('config:changed', { config: publicConfig(), layout: layoutInfo() });
}

function layoutInfo() {
  const c = config.get();
  const wa = targetWorkArea();
  // Con una posizione trascinata conta l'angolo agganciato; "corner" resta l'angolo di ritorno.
  return { corner: c.customAnchor ? c.customAnchor.corner : c.corner, maxHeight: wa.height - 2 * c.margin, maxWidth: wa.width - 2 * c.margin };
}

// ------------------------------------------------------------ mostra/nascondi

function showOverlay(mode) {
  if (!win) return;
  const visible = win.isVisible();
  if (visible && win.isFocused() && mode === currentMode && !ghost) {
    // Seconda pressione della stessa scorciatoia: chiude (come la quick entry).
    win.webContents.send('overlay:request-hide');
    return;
  }
  if (!visible) {
    workArea = null; // ricompare sul monitor dove si trova il mouse
    place();
  }
  if (ghost) setGhost(false);
  win.show();
  win.focus();
  currentMode = mode;
  updateTray();
  if (mode === 'chat' && config.get().backend === 'subscription') subscriptionChat.warm();
  win.webContents.send('overlay:show', { mode, ...layoutInfo() });
}

function hideOverlay() {
  if (!win) return;
  if (ghost) setGhost(false);
  win.hide();
  updateTray();
}

// ---------------------------------------------------------- Ctrl in fantasma
// In modalità fantasma la finestra non ha mai il focus, quindi non "vede" i tasti.
// Su Windows un piccolo PowerShell legge lo stato reale di Ctrl (GetAsyncKeyState,
// valido anche mentre lavori in Maya/ZBrush) e lo comunica qui: con Ctrl premuto
// il pop-up torna cliccabile. Gira solo finché la modalità fantasma è attiva.
let ctrlWatcher = null;
let ctrlDown = false;

function startCtrlWatcher() {
  if (process.platform !== 'win32' || ctrlWatcher) return;
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class OverlayKeys {',
    '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);',
    '}',
    '"@',
    '$last = -1',
    'while ($true) {',
    '  $down = 0',
    '  if (([OverlayKeys]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0) { $down = 1 }',
    '  if ($down -ne $last) { [Console]::Out.WriteLine($down); [Console]::Out.Flush(); $last = $down }',
    '  Start-Sleep -Milliseconds 40',
    '}',
  ].join('\r\n');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  ctrlWatcher = child;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    const last = chunk.trim().split(/\s+/).pop();
    if (last === '1' || last === '0') setCtrlDown(last === '1');
  });
  child.on('error', () => {});
  child.on('exit', () => {
    if (ctrlWatcher === child) ctrlWatcher = null;
  });
}

function stopCtrlWatcher() {
  if (ctrlWatcher) ctrlWatcher.kill();
  ctrlWatcher = null;
  setCtrlDown(false);
}

function setCtrlDown(down) {
  if (ctrlDown === down) return;
  ctrlDown = down;
  if (win && ghost) win.webContents.send('overlay:peek', down);
}

function setGhost(on) {
  ghost = Boolean(on);
  if (ghost) startCtrlWatcher();
  else stopCtrlWatcher();
  if (!win) return;
  // forward: true continua a inoltrare il movimento del mouse, così il pulsante
  // "fantasma" può tornare cliccabile quando ci passi sopra.
  win.setIgnoreMouseEvents(ghost, { forward: true });
  win.setFocusable(!ghost);
  win.setSkipTaskbar(true); // su Windows setFocusable(true) lo rimetterebbe nella barra delle applicazioni
  win.webContents.send('overlay:ghost', ghost);
  updateTray();
}

// ---------------------------------------------------------------- scorciatoie

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const c = config.get();
  const failed = [];
  const reg = (acc, fn) => {
    if (!acc) return;
    try {
      if (!globalShortcut.register(acc, fn)) failed.push(acc);
    } catch {
      failed.push(acc);
    }
  };
  reg(c.hotkeyChat, () => showOverlay('chat'));
  reg(c.hotkeyNotes, () => showOverlay('notes'));
  reg(c.hotkeyGhost, () => {
    if (win && win.isVisible()) setGhost(!ghost);
  });
  hotkeyFailures = failed;
  return failed;
}

function notifyHotkeyFailure(failed) {
  const msg = `Scorciatoie non registrate (già usate da un'altra app?): ${failed.join(', ')}`;
  if (tray && process.platform === 'win32') tray.displayBalloon({ title: 'Claude Overlay', content: msg });
  else console.warn(msg);
}

function pretty(acc) {
  return String(acc || '').replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl');
}

// ------------------------------------------------------------------- tray

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Claude Overlay');
  tray.on('click', () => showOverlay('chat'));
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const c = config.get();
  const menu = Menu.buildFromTemplate([
    { label: `Chiedi a Claude\t${pretty(c.hotkeyChat)}`, click: () => showOverlay('chat') },
    { label: `Cerca nelle note\t${pretty(c.hotkeyNotes)}`, click: () => showOverlay('notes') },
    { type: 'separator' },
    {
      label: 'Posizione',
      submenu: CORNERS.map(([id, label]) => ({
        label,
        type: 'radio',
        checked: c.corner === id,
        click: () => {
          config.setAnchor(null); // scegliere un angolo annulla la posizione trascinata
          applyConfig({ corner: id });
        },
      })),
    },
    {
      label: `Modalità fantasma (click-through)\t${pretty(c.hotkeyGhost)}`,
      type: 'checkbox',
      checked: ghost,
      enabled: Boolean(win && win.isVisible()),
      click: (item) => setGhost(item.checked),
    },
    {
      label: 'Avvia con Windows',
      type: 'checkbox',
      checked: c.startAtLogin,
      visible: process.platform === 'win32' || process.platform === 'darwin',
      click: (item) => applyConfig({ startAtLogin: item.checked }),
    },
    { label: 'Impostazioni…', click: () => showOverlay('settings') },
    { label: 'Apri cartella configurazione', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: 'Esci', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------- config

function applyConfig(patch, apiKey) {
  const before = { ...config.get() };
  const c = config.update(patch);
  if (apiKey !== undefined && apiKey !== null) config.setApiKey(apiKey);
  if (c.corner !== before.corner && before.customAnchor) config.setAnchor(null);
  if (c.vaultPath !== before.vaultPath) {
    if (vault) vault.close();
    vault = new Vault(c.vaultPath);
  }
  if (c.backend !== before.backend) {
    sentNotes.clear();
    // Cambiando collegamento si riparte da una conversazione nuova.
    apiChat.reset();
    subscriptionChat.reset();
  }
  if (c.startAtLogin !== before.startAtLogin && (process.platform === 'win32' || process.platform === 'darwin')) {
    // Senza pacchetto (Avvia.cmd / npm start) serve anche la cartella dell'app, altrimenti parte Electron "vuoto".
    const login = { openAtLogin: c.startAtLogin };
    if (process.env.PORTABLE_EXECUTABLE_FILE) login.path = process.env.PORTABLE_EXECUTABLE_FILE;
    else if (!app.isPackaged) login.args = [app.getAppPath()];
    app.setLoginItemSettings(login);
  }
  let failed = [];
  if (c.hotkeyChat !== before.hotkeyChat || c.hotkeyNotes !== before.hotkeyNotes || c.hotkeyGhost !== before.hotkeyGhost) {
    failed = registerHotkeys();
  }
  place();
  updateTray();
  const view = publicConfig();
  if (win) win.webContents.send('config:changed', { config: view, layout: layoutInfo() });
  return { config: view, failedHotkeys: failed };
}

function publicConfig() {
  return { ...config.publicView(), vaultName: vault ? vault.name : '', hotkeyFailures };
}

// ------------------------------------------------------------------- utility

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:', 'obsidian:'].includes(u.protocol)) shell.openExternal(u.toString());
  } catch {
    // URL non valido: ignorato
  }
}

// Dettatura: premi Win+H per conto dell'utente, così parte la digitazione vocale
// di Windows dentro il campo di testo dell'overlay (che ha il focus).
function triggerWindowsDictation() {
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class OverlayKb {',
    '  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);',
    '}',
    '"@',
    '[OverlayKb]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)',
    '[OverlayKb]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)',
    'Start-Sleep -Milliseconds 40',
    '[OverlayKb]::keybd_event(0x48, 0, 2, [UIntPtr]::Zero)',
    '[OverlayKb]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)',
  ].join('\r\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: 'ignore' }
  );
  child.on('error', () => {});
}

async function noteAsContext(rel) {
  const note = await vault.read(rel);
  return `<nota_obsidian titolo="${note.title.replace(/"/g, "'")}">\n${note.text}\n</nota_obsidian>`;
}

const NOTE_CONTEXT_LIMIT = 12000;

/** Le 3 note più pertinenti del vault, da passare a Claude come contesto. */
async function relatedNotesContext(question, skipRel) {
  if (!vault || !vault.root) return { text: '', used: [] };
  let notes = [];
  try {
    notes = await vault.relevant(question, 3, [DIRS.rough, DIRS.template, DIRS.source, DIRS.tags, DIRS.indexes]);
  } catch {
    return { text: '', used: [] };
  }
  notes = notes.filter((n) => n.rel !== skipRel);
  if (!notes.length) return { text: '', used: [] };
  const used = notes.map((n) => ({ rel: n.rel, title: n.title }));
  // Le note già mandate in questa conversazione (e non cambiate) Claude le ha già: non le rimando.
  const fresh = notes.filter((n) => sentNotes.get(n.rel) !== digest(n.text));
  if (!fresh.length) return { text: '', used, fresh: [] };
  for (const n of fresh) sentNotes.set(n.rel, digest(n.text));
  const body = fresh
    .map((n) => {
      const text = n.text.length > NOTE_CONTEXT_LIMIT ? `${n.text.slice(0, NOTE_CONTEXT_LIMIT)}\n[… nota troncata …]` : n.text;
      return `<nota titolo="${n.title.replace(/"/g, "'")}" percorso="${n.rel.replace(/"/g, "'")}">\n${text}\n</nota>`;
    })
    .join('\n\n');
  return {
    text:
      '<note_utente>\nQueste sono le note dell\'utente. Resta coerente con quello che c\'è scritto; ' +
      `se una nota è sbagliata o incompleta dillo.\n\n${body}\n</note_utente>`,
    used,
    fresh: fresh.map((n) => n.rel),
  };
}

const sentNotes = new Map(); // percorso → impronta della nota già inviata in questa conversazione
const digest = (text) => require('crypto').createHash('sha1').update(text).digest('hex');

// ------------------------------------------------------------------------ IPC

ipcMain.handle('config:get', () => ({ config: publicConfig(), layout: layoutInfo() }));

ipcMain.handle('config:save', (_e, { patch, apiKey }) => {
  try {
    return { ok: true, ...applyConfig(patch, apiKey) };
  } catch (err) {
    return { ok: false, error: `Impostazioni non salvate: ${err.message}`, config: publicConfig(), failedHotkeys: [] };
  }
});

ipcMain.handle('vault:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Scegli la cartella del vault di Obsidian',
    properties: ['openDirectory'],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

ipcMain.handle('chat:send', async (e, { text, contextRel, images }) => {
  const question = String(text || '').trim();
  const mySend = ++sendSeq;
  const parts = [];
  if (contextRel) {
    try {
      parts.push(await noteAsContext(contextRel));
    } catch (err) {
      return { ok: false, error: `Impossibile leggere la nota allegata: ${err.message}` };
    }
  }
  const related = await relatedNotesContext(question, contextRel);
  // Interrotta (Esc / nuova chat) mentre cercavo le note: non la mando.
  if (cancelledUpTo >= mySend) return { ok: false, aborted: true, error: 'Interrotto.', usedNotes: [] };
  if (related.text) parts.push(related.text);
  parts.push(question);
  const textPart = parts.join('\n\n');
  const imgs = Array.isArray(images) ? images.filter((i) => i && i.data && i.mediaType) : [];
  const content = imgs.length
    ? [
        ...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })),
        { type: 'text', text: textPart },
      ]
    : textPart;
  const send = (channel, payload) => {
    if (!e.sender.isDestroyed()) e.sender.send(channel, payload);
  };
  const result = await activeChat().send(
    content,
    (delta) => send('chat:delta', delta),
    (status) => send('chat:status', status)
  );
  // Se la domanda non è andata a buon fine, quelle note non sono nella conversazione.
  if (!result.ok) for (const rel of related.fresh || []) sentNotes.delete(rel);
  return { ...result, usedNotes: related.used };
});

ipcMain.handle('archive:run', async (_e, job) => {
  try {
    return await archivist.archive(job || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('archive:undo', async (_e, opId) => {
  try {
    return await archivist.undo(opId);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('chat:abort', () => {
  cancelledUpTo = sendSeq;
  activeChat().abort();
});
ipcMain.on('chat:reset', () => {
  cancelledUpTo = sendSeq;
  sentNotes.clear();
  apiChat.reset();
  subscriptionChat.reset();
});

ipcMain.handle('cc:check', (_e, customPath) => checkClaudeCode(customPath ?? config.get().claudePath));

ipcMain.handle('notes:search', async (_e, q) => {
  try {
    return { ok: true, results: await vault.search(q) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('notes:read', async (_e, rel) => {
  try {
    return { ok: true, note: await vault.read(rel) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('notes:resolve', async (_e, link) => {
  try {
    return { ok: true, rel: await vault.resolveLink(link) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

const IMAGE_TYPES = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', bmp: 'bmp', svg: 'svg+xml' };

ipcMain.handle('notes:image', async (_e, name) => {
  try {
    const full = vault ? await vault.resolveAsset(name) : null;
    if (!full) return { ok: false, error: 'Immagine non trovata.' };
    const type = IMAGE_TYPES[path.extname(full).slice(1).toLowerCase()];
    const st = await require('fs').promises.stat(full);
    if (!type || st.size > 15 * 1024 * 1024) return { ok: false, error: 'Immagine non visualizzabile.' };
    const data = await require('fs').promises.readFile(full);
    return { ok: true, url: `data:image/${type};base64,${data.toString('base64')}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('notes:open', (_e, rel) => {
  if (!vault || !vault.name || !rel) return;
  const file = String(rel).replace(/\.md$/i, '');
  openExternalSafe(`obsidian://open?vault=${encodeURIComponent(vault.name)}&file=${encodeURIComponent(file)}`);
});

ipcMain.on('open:external', (_e, url) => openExternalSafe(url));

ipcMain.on('win:resize', (_e, { w, h }) => {
  const nw = Math.round(Number(w));
  const nh = Math.round(Number(h));
  if (!Number.isFinite(nw) || !Number.isFinite(nh)) return;
  if (nw === size.w && nh === size.h) return;
  size = { w: nw, h: nh };
  place();
});

ipcMain.on('win:hide', () => hideOverlay());

// Trascinamento dalla barra in alto (gestito qui per controllare posizione e memoria).
let dragStart = null;
ipcMain.on('win:drag-start', () => {
  if (win) dragStart = win.getBounds();
});
ipcMain.on('win:drag-move', (_e, { dx, dy }) => {
  if (!win || !dragStart || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  win.setBounds({ ...dragStart, x: Math.round(dragStart.x + dx), y: Math.round(dragStart.y + dy) });
});
ipcMain.on('win:drag-end', () => {
  if (!win || !dragStart) return;
  dragStart = null;
  saveDraggedPosition();
});
ipcMain.on('win:reset-position', () => {
  config.setAnchor(null);
  workArea = null;
  place();
  if (win) win.webContents.send('config:changed', { config: publicConfig(), layout: layoutInfo() });
});
ipcMain.on('win:ghost', (_e, on) => setGhost(on));
ipcMain.on('win:ignore-mouse', (_e, ignore) => {
  if (win && ghost) win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});
ipcMain.on('win:state', (_e, state) => {
  if (state && typeof state.mode === 'string') currentMode = state.mode;
});

ipcMain.handle('dictate', () => {
  if (process.platform !== 'win32') return { ok: false, error: 'La dettatura automatica è disponibile solo su Windows.' };
  if (win) win.focus();
  triggerWindowsDictation();
  return { ok: true };
});
