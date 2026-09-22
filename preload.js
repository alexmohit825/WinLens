// ============================================================
// WinLens — Preload Script
// Secure bridge between main process and renderer via contextBridge
// ============================================================
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('winlens', {
  // Trigger a screen capture
  captureScreen: () => ipcRenderer.invoke('capture-screen'),

  // Hide the panel to tray
  hideWindow: () => ipcRenderer.invoke('hide-window'),

  // Get the registered hotkey string (for display in UI)
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),

  // Open a URL in the system browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Set always-on-top (user toggle)
  setAlwaysOnTop: (val) => ipcRenderer.send('set-always-on-top', val),

  // View full screenshot in dedicated viewer window
  viewFullScreenshot: (dataUrl) => ipcRenderer.invoke('view-full-screenshot', dataUrl),

  // Listen for screenshot data from main process
  onScreenshot: (callback) => {
    ipcRenderer.on('screenshot-captured', (_, dataUrl) => callback(dataUrl));
  },

  // Listen for capture errors
  onCaptureError: (callback) => {
    ipcRenderer.on('capture-error', (_, msg) => callback(msg));
  },

  // Remove all listeners (cleanup)
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('screenshot-captured');
    ipcRenderer.removeAllListeners('capture-error');
  },
});
