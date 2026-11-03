'use strict';
// API minima esposta al renderer (contextIsolation attivo, niente Node nel renderer).

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['overlay:show', 'overlay:request-hide', 'overlay:ghost', 'config:changed', 'chat:delta']);

contextBridge.exposeInMainWorld('overlay', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch, apiKey) => ipcRenderer.invoke('config:save', { patch, apiKey }),
  pickVault: () => ipcRenderer.invoke('vault:pick'),

  chatSend: (text, contextRel) => ipcRenderer.invoke('chat:send', { text, contextRel }),
  chatAbort: () => ipcRenderer.send('chat:abort'),
  chatReset: () => ipcRenderer.send('chat:reset'),

  notesSearch: (q) => ipcRenderer.invoke('notes:search', q),
  notesRead: (rel) => ipcRenderer.invoke('notes:read', rel),
  notesResolve: (link) => ipcRenderer.invoke('notes:resolve', link),
  notesAppend: (text) => ipcRenderer.invoke('notes:append', text),
  openInObsidian: (rel) => ipcRenderer.send('notes:open', rel),
  openExternal: (url) => ipcRenderer.send('open:external', url),

  resize: (w, h) => ipcRenderer.send('win:resize', { w, h }),
  hide: () => ipcRenderer.send('win:hide'),
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
