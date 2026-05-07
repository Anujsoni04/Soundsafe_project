'use strict';
// Preload is minimal since we use nodeIntegration:true for simplicity
// In production, replace with proper contextBridge exposure
const { ipcRenderer } = require('electron');
window.ipcRenderer = ipcRenderer;
