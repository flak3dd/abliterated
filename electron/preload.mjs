/**
 * Preload: expose a minimal desktop API to the renderer (contextIsolation).
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ablitDesktop', {
  getLicense: () => ipcRenderer.invoke('ablit:getLicense'),
  setLicense: (key) => ipcRenderer.invoke('ablit:setLicense', key),
  getVersion: () => ipcRenderer.invoke('ablit:getVersion'),
  platform: process.platform,
});
