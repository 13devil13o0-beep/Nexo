/**
 * 🔒 NEXO Desktop - Preload Script
 * 
 * Bridge segura entre renderer e main process
 */

const { contextBridge, ipcRenderer } = require('electron');

// API exposta ao renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Core
  getCoreStatus: () => ipcRenderer.invoke('get-core-status'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Janela
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  
  // Utilitários
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  
  // Eventos do main
  onCoreStatus: (callback) => ipcRenderer.on('core-status', (_, data) => callback(data)),
  onNewConversation: (callback) => ipcRenderer.on('new-conversation', () => callback()),
  onShowPreferences: (callback) => ipcRenderer.on('show-preferences', () => callback()),
  
  // Remover listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Informação da plataforma
contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isElectron: true
});

console.log('[Preload] API exposta ao renderer');
