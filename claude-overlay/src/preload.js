'use strict';
// API minima esposta al renderer (contextIsolation attivo, niente Node nel renderer).

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'overlay:show',
  'overlay:request-hide',
  'overlay:ghost',
  'config:changed',
  'chat:delta',
  'chat:status',
]);

contextBridge.exposeInMainWorld('overlay', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch, apiKey) => ipcRenderer.invoke('config:save', { patch, apiKey }),
  pickVault: () => ipcRenderer.invoke('vault:pick'),

  chatSend: (text, contextRel, images) => ipcRenderer.invoke('chat:send', { text, contextRel, images }),
  chatAbort: () => ipcRenderer.send('chat:abort'),
  chatReset: () => ipcRenderer.send('chat:reset'),
  checkClaudeCode: (customPath) => ipcRenderer.invoke('cc:check', customPath),

  notesSearch: (q) => ipcRenderer.invoke('notes:search', q),
  notesRead: (rel) => ipcRenderer.invoke('notes:read', rel),
  notesResolve: (link) => ipcRenderer.invoke('notes:resolve', link),
  notesImage: (name) => ipcRenderer.invoke('notes:image', name),
  archive: (job) => ipcRenderer.invoke('archive:run', job),
  archiveUndo: (opId) => ipcRenderer.invoke('archive:undo', opId),
  openInObsidian: (rel) => ipcRenderer.send('notes:open', rel),
  openExternal: (url) => ipcRenderer.send('open:external', url),

  resize: (w, h) => ipcRenderer.send('win:resize', { w, h }),
  hide: () => ipcRenderer.send('win:hide'),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('win:drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  resetPosition: () => ipcRenderer.send('win:reset-position'),
  setGhost: (on) => ipcRenderer.send('win:ghost', on),
  setIgnoreMouse: (ignore) => ipcRenderer.send('win:ignore-mouse', ignore),
  reportState: (state) => ipcRenderer.send('win:state', state),
  dictate: () => ipcRenderer.invoke('dictate'),

  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error(`Evento non consentito: ${channel}`);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
