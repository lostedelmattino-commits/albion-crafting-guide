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
const { Vault } = require('./obsidian');

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
const chat = new ClaudeChat(
  () => config.get(),
  () => config.getApiKey()
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showOverlay('chat'));
  app.whenReady().then(start);
}

app.on('window-all-closed', () => {
  // L'app vive nella barra di sistema: non si chiude con la finestra.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  chat.abort();
});

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('dev.claude-overlay');
  const cfg = config.get();
  vault = new Vault(cfg.vaultPath);
  createWindow();
  createTray();
  const failed = registerHotkeys();
  if (failed.length) notifyHotkeyFailure(failed);

  screen.on('display-metrics-changed', () => {
    workArea = null;
    place();
  });

  const needsKey = !config.getApiKey() && !process.env.ANTHROPIC_API_KEY;
  win.webContents.once('did-finish-load', () => {
    if (needsKey) {
      showOverlay('settings');
    } else if (tray && process.platform === 'win32') {
      tray.displayBalloon({
        title: 'Claude Overlay è attivo',
        content: `${pretty(cfg.hotkeyChat)} per Claude · ${pretty(cfg.hotkeyNotes)} per le note`,
      });
    }
  });
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

function place() {
  if (!win) return;
  const c = config.get();
  const wa = currentWorkArea();
  const m = c.margin;
  const w = Math.max(200, Math.min(size.w, wa.width - 2 * m));
  const h = Math.max(60, Math.min(size.h, wa.height - 2 * m));
  const x = c.corner.endsWith('right') ? wa.x + wa.width - w - m : wa.x + m;
  const y = c.corner.startsWith('bottom') ? wa.y + wa.height - h - m : wa.y + m;
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
}

function layoutInfo() {
  const c = config.get();
  const wa = currentWorkArea();
  return { corner: c.corner, maxHeight: wa.height - 2 * c.margin, maxWidth: wa.width - 2 * c.margin };
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
  win.webContents.send('overlay:show', { mode, ...layoutInfo() });
}

function hideOverlay() {
  if (!win) return;
  if (ghost) setGhost(false);
  win.hide();
  updateTray();
}

function setGhost(on) {
  ghost = Boolean(on);
  if (!win) return;
  // forward: true continua a inoltrare il movimento del mouse, così il pulsante
  // "fantasma" può tornare cliccabile quando ci passi sopra.
  win.setIgnoreMouseEvents(ghost, { forward: true });
  win.setFocusable(!ghost);
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
        click: () => applyConfig({ corner: id }),
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
  if (c.vaultPath !== before.vaultPath) vault = new Vault(c.vaultPath);
  if (c.startAtLogin !== before.startAtLogin && (process.platform === 'win32' || process.platform === 'darwin')) {
    app.setLoginItemSettings({ openAtLogin: c.startAtLogin });
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
  return { ...config.publicView(), vaultName: vault ? vault.name : '' };
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

// ------------------------------------------------------------------------ IPC

ipcMain.handle('config:get', () => ({ config: publicConfig(), layout: layoutInfo() }));

ipcMain.handle('config:save', (_e, { patch, apiKey }) => applyConfig(patch, apiKey));

ipcMain.handle('vault:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Scegli la cartella del vault di Obsidian',
    properties: ['openDirectory'],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

ipcMain.handle('chat:send', async (e, { text, contextRel }) => {
  let content = String(text || '').trim();
  if (contextRel) {
    try {
      content = `${await noteAsContext(contextRel)}\n\n${content}`;
    } catch (err) {
      return { ok: false, error: `Impossibile leggere la nota allegata: ${err.message}` };
    }
  }
  return chat.send(content, (delta) => {
    if (!e.sender.isDestroyed()) e.sender.send('chat:delta', delta);
  });
});

ipcMain.on('chat:abort', () => chat.abort());
ipcMain.on('chat:reset', () => chat.reset());

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

ipcMain.handle('notes:append', async (_e, text) => {
  try {
    return { ok: true, rel: await vault.append(text, config.get().inboxFolder) };
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
