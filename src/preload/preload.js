'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  hit: (inside) => ipcRenderer.send('pet:hit', Boolean(inside)),

  dragBegin: (x, y) => ipcRenderer.send('pet:drag-begin', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('pet:drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),

  click: () => ipcRenderer.send('pet:click'),

  companion: () => ipcRenderer.invoke('pet:companion'),

  /* 语音 */
  voiceInfo: () => ipcRenderer.invoke('pet:voice-info'),
  isMuted: () => ipcRenderer.invoke('pet:is-muted'),
  // 托盘里勾了静音，主进程推过来
  onMuteChanged: (fn) => {
    const handler = (_e, value) => fn(Boolean(value));
    ipcRenderer.on('pet:muted', handler);
    return () => ipcRenderer.removeListener('pet:muted', handler);
  },

  /* 标注工具 */
  voiceLoad: () => ipcRenderer.invoke('voice:load'),
  voiceSave: (payload) => ipcRenderer.invoke('voice:save', payload),
});
