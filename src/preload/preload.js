'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  hit: (inside) => ipcRenderer.send('pet:hit', Boolean(inside)),

  dragBegin: (x, y) => ipcRenderer.send('pet:drag-begin', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('pet:drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),

  click: () => ipcRenderer.send('pet:click'),

  companion: () => ipcRenderer.invoke('pet:companion'),

  /* 时装 */
  outfits: () => ipcRenderer.invoke('pet:outfits'),
  setOutfit: (id) => ipcRenderer.invoke('pet:set-outfit', String(id)),
  // 托盘里换了衣服，主进程推过来
  onOutfitChanged: (fn) => {
    const handler = (_e, outfit) => fn(outfit);
    ipcRenderer.on('pet:outfit', handler);
    return () => ipcRenderer.removeListener('pet:outfit', handler);
  },

  /* 语音 */
  voiceInfo: () => ipcRenderer.invoke('pet:voice-info'),
  isMuted: () => ipcRenderer.invoke('pet:is-muted'),
  // 托盘里勾了静音，主进程推过来
  onMuteChanged: (fn) => {
    const handler = (_e, value) => fn(Boolean(value));
    ipcRenderer.on('pet:muted', handler);
    return () => ipcRenderer.removeListener('pet:muted', handler);
  },

  /* 姿态：托盘里手动指定，或交还给状态机 */
  setMood: (id) => ipcRenderer.send('pet:set-mood', String(id)),
  reportMood: (mood, locked) => ipcRenderer.send('pet:mood-state', { mood: String(mood), locked: Boolean(locked) }),
  onMoodSet: (fn) => {
    const handler = (_e, id) => fn(String(id));
    ipcRenderer.on('pet:mood-set', handler);
    return () => ipcRenderer.removeListener('pet:mood-set', handler);
  },

  /* 标注工具 */
  voiceLoad: () => ipcRenderer.invoke('voice:load'),
  voiceSave: (payload) => ipcRenderer.invoke('voice:save', payload),
});
