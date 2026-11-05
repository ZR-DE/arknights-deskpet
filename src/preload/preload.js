'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  hit: (inside) => ipcRenderer.send('pet:hit', Boolean(inside)),

  dragBegin: (x, y) => ipcRenderer.send('pet:drag-begin', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('pet:drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),

  click: () => ipcRenderer.send('pet:click'),

  companion: () => ipcRenderer.invoke('pet:companion'),
});
